import { isPositiveInteger } from "@/domain/money/currency";
import { EXPIRABLE_PLAN_STATUSES, isTerminalPlanStatus, type PlanStatus } from "./statuses";
import type {
  HoldCapture,
  MemberSnapshot,
  PlanEffect,
  PlanEvent,
  PlanEventType,
  PlanSnapshot,
  TransitionErrorCode,
  TransitionResult,
} from "./types";

type EventOf<T extends PlanEventType> = Extract<PlanEvent, { type: T }>;
type Handler<T extends PlanEventType> = (plan: PlanSnapshot, event: EventOf<T>) => TransitionResult;
type HandlerMap = { [T in PlanEventType]: Handler<T> };

const fail = (code: TransitionErrorCode, message: string): TransitionResult => ({
  ok: false,
  error: { code, message },
});

const succeed = (plan: PlanSnapshot, effects: readonly PlanEffect[] = []): TransitionResult => ({
  ok: true,
  plan,
  effects,
});

const requireStatus = (
  plan: PlanSnapshot,
  allowed: readonly PlanStatus[],
  eventType: PlanEventType,
): TransitionResult | null =>
  allowed.includes(plan.status)
    ? null
    : fail("invalid_status", `${eventType} is not allowed while the plan is ${plan.status}`);

const findMember = (plan: PlanSnapshot, memberId: string): MemberSnapshot | undefined =>
  plan.members.find((member) => member.id === memberId);

const replaceMember = (plan: PlanSnapshot, updated: MemberSnapshot): PlanSnapshot => ({
  ...plan,
  members: plan.members.map((member) => (member.id === updated.id ? updated : member)),
});

const everyMemberHasHold = (plan: PlanSnapshot): boolean =>
  plan.members.every((member) => member.approval === "approved" && member.holdPlaced);

const releaseHolds = (memberIds: readonly string[]): readonly PlanEffect[] =>
  memberIds.length > 0 ? [{ type: "release_holds", memberIds }] : [];

/** Ends the plan and gives every placed hold back. Nobody is charged. */
const expire = (plan: PlanSnapshot): TransitionResult =>
  succeed(
    { ...plan, status: "expired" },
    releaseHolds(plan.members.filter((member) => member.holdPlaced).map((member) => member.id)),
  );

/**
 * Works out what to charge each member at booking. A member pays today's share, which can be lower than
 * the cap they approved but never higher; the unused part of their hold goes back to them alone.
 */
function planCaptures(plan: PlanSnapshot): HoldCapture[] | null {
  const captures: HoldCapture[] = [];
  for (const member of plan.members) {
    const { approvedMinor, currentShareMinor } = member;
    if (approvedMinor === null || currentShareMinor === null || currentShareMinor > approvedMinor) return null;
    captures.push({ memberId: member.id, captureMinor: currentShareMinor, releaseMinor: approvedMinor - currentShareMinor });
  }
  return captures;
}

const handlers: HandlerMap = {
  approval_started: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["draft"], event.type);
    if (wrongStatus) return wrongStatus;
    if (plan.members.length === 0) return fail("no_members", "A plan needs at least one member");
    return succeed({ ...plan, status: "approving" });
  },

  member_approved: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["approving"], event.type);
    if (wrongStatus) return wrongStatus;
    const member = findMember(plan, event.memberId);
    if (!member) return fail("unknown_member", `No member ${event.memberId}`);
    if (member.approval !== "pending" && member.approval !== "needs_reapproval") {
      return fail("invalid_member_state", `Member is already ${member.approval}`);
    }
    if (!isPositiveInteger(event.amountMinor)) {
      return fail("invalid_amount", "Approved amount must be a positive integer in minor units");
    }
    if (event.expiresAt <= event.at || event.expiresAt > plan.deadlineAt) {
      return fail("invalid_expiry", "Approval must expire in the future and no later than the plan deadline");
    }
    const approved: MemberSnapshot = {
      ...member,
      approval: "approved",
      approvedMinor: event.amountMinor,
      currentShareMinor: event.amountMinor,
      chargedMinor: null,
      approvalExpiresAt: event.expiresAt,
      holdPlaced: false,
    };
    return succeed(replaceMember(plan, approved), [
      { type: "place_hold", memberId: member.id, amountMinor: event.amountMinor },
    ]);
  },

  member_declined: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["approving", "held"], event.type);
    if (wrongStatus) return wrongStatus;
    if (!findMember(plan, event.memberId)) return fail("unknown_member", `No member ${event.memberId}`);
    return expire(plan);
  },

  hold_placed: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["approving"], event.type);
    if (wrongStatus) return wrongStatus;
    const member = findMember(plan, event.memberId);
    if (!member) return fail("unknown_member", `No member ${event.memberId}`);
    if (member.approval !== "approved" || member.holdPlaced) {
      return fail("invalid_member_state", "A hold needs an approved member without an existing hold");
    }
    const updated = replaceMember(plan, { ...member, holdPlaced: true });
    if (!everyMemberHasHold(updated)) return succeed(updated);
    return succeed({ ...updated, status: "held" }, [{ type: "book" }]);
  },

  price_rechecked: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["approving", "held"], event.type);
    if (wrongStatus) return wrongStatus;
    const member = findMember(plan, event.memberId);
    if (!member) return fail("unknown_member", `No member ${event.memberId}`);
    if (member.approval !== "approved" || member.approvedMinor === null) {
      return fail("invalid_member_state", "Member has no approved amount to compare against");
    }
    if (!isPositiveInteger(event.currentMinor)) {
      return fail("invalid_amount", "Current price must be a positive integer in minor units");
    }

    if (event.currentMinor <= member.approvedMinor) {
      // Within the cap: the member will simply be charged this lower or equal amount.
      if (event.currentMinor === member.currentShareMinor) return succeed(plan);
      return succeed(replaceMember(plan, { ...member, currentShareMinor: event.currentMinor }));
    }

    // Over the cap: only the affected member goes back to approve; everyone else's approval stays valid.
    const reopened: MemberSnapshot = {
      ...member,
      approval: "needs_reapproval",
      approvedMinor: null,
      currentShareMinor: null,
      approvalExpiresAt: null,
      holdPlaced: false,
    };
    return succeed({ ...replaceMember(plan, reopened), status: "approving" }, [
      ...releaseHolds(member.holdPlaced ? [member.id] : []),
      { type: "request_reapproval", memberId: member.id, newAmountMinor: event.currentMinor },
    ]);
  },

  booking_succeeded: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["held"], event.type);
    if (wrongStatus) return wrongStatus;
    if (event.at >= plan.deadlineAt) {
      return fail("deadline_reached", "The plan deadline has passed, so the holds can no longer be charged");
    }
    const captures = planCaptures(plan);
    if (!captures) {
      return fail("invalid_member_state", "A member's current share is missing or above what they approved");
    }
    return succeed({ ...plan, status: "booked" }, [{ type: "capture_holds", captures }]);
  },

  booking_failed: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["held"], event.type);
    if (wrongStatus) return wrongStatus;
    return expire(plan);
  },

  capture_succeeded: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["booked"], event.type);
    if (wrongStatus) return wrongStatus;
    return succeed({
      ...plan,
      status: "captured",
      members: plan.members.map((member) => ({ ...member, chargedMinor: member.currentShareMinor })),
    });
  },

  // A booked plan has everyone in, so the deadline can no longer cancel it.
  deadline_passed: (plan, event) => {
    const wrongStatus = requireStatus(plan, EXPIRABLE_PLAN_STATUSES, event.type);
    if (wrongStatus) return wrongStatus;
    if (event.at < plan.deadlineAt) return fail("deadline_not_reached", "The plan deadline has not passed");
    return expire(plan);
  },

  deadline_extended: (plan, event) => {
    const wrongStatus = requireStatus(plan, EXPIRABLE_PLAN_STATUSES, event.type);
    if (wrongStatus) return wrongStatus;
    if (event.newDeadlineAt <= plan.deadlineAt || event.newDeadlineAt > plan.hardDeadlineAt) {
      return fail("invalid_deadline", "The new deadline must be later than the current one and within the hard cap");
    }
    // Approvals last as long as the deadline, so they move with it.
    return succeed({
      ...plan,
      deadlineAt: event.newDeadlineAt,
      members: plan.members.map((member) =>
        member.approval === "approved" ? { ...member, approvalExpiresAt: event.newDeadlineAt } : member,
      ),
    });
  },

  offers_unavailable: (plan, event) => {
    const wrongStatus = requireStatus(plan, EXPIRABLE_PLAN_STATUSES, event.type);
    if (wrongStatus) return wrongStatus;
    return expire(plan);
  },
};

/** Applies one event to a plan. Pure: returns the next plan and effects, or a typed error. */
export function transition(plan: PlanSnapshot, event: PlanEvent): TransitionResult {
  if (isTerminalPlanStatus(plan.status)) {
    return fail("plan_closed", `The plan is ${plan.status} and accepts no more events`);
  }
  const handle = handlers[event.type] as (plan: PlanSnapshot, event: PlanEvent) => TransitionResult;
  return handle(plan, event);
}
