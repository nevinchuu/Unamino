import { isNonNegativeInteger } from "@/domain/money/currency";
import { isMaterialRise } from "./material-rise";
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

/**
 * Everyone who approved has a hold to let go of, whether or not their card is on it yet: the hold is made when they
 * approve, and the card is added to it afterwards. Letting go of one that has no card yet is harmless.
 */
const approvedMemberIds = (plan: PlanSnapshot): readonly string[] => plan.members.filter((member) => member.approval === "approved").map((member) => member.id);

const memberIdsOf = (plan: PlanSnapshot): readonly string[] => plan.members.map((member) => member.id);

/** Back to step 1 for everyone: agreements and approvals are cleared, because they were given for a different plan. */
const reopenReview = (plan: PlanSnapshot): PlanSnapshot => ({
  ...plan,
  status: "reviewing",
  members: plan.members.map((member) => ({
    ...member,
    planAgreement: "pending",
    agreedShareMinor: null,
    approval: "pending",
    approvedMinor: null,
    currentShareMinor: null,
    chargedMinor: null,
    approvalExpiresAt: null,
    holdPlaced: false,
  })),
});

/** Ends the plan and gives every placed hold back. Nobody is charged. */
const expire = (plan: PlanSnapshot): TransitionResult =>
  succeed(
    { ...plan, status: "expired" },
    releaseHolds(approvedMemberIds(plan)),
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
    // Nothing was held for someone whose share is covered, so there is nothing to charge or give back.
    if (approvedMinor === 0) continue;
    captures.push({ memberId: member.id, captureMinor: currentShareMinor, releaseMinor: approvedMinor - currentShareMinor });
  }
  return captures;
}

/**
 * During review there is no cap, so a rise is judged against the price the member agreed to see.
 * Small rises are shown to the member as a note; a rise past the threshold sends everyone back to look again.
 */
function recheckDuringReview(plan: PlanSnapshot, member: MemberSnapshot, currentMinor: number): TransitionResult {
  if (member.agreedShareMinor === null || !isMaterialRise(member.agreedShareMinor, currentMinor)) return succeed(plan);
  return succeed(reopenReview(plan), [{ type: "request_review", memberIds: memberIdsOf(plan) }]);
}

/** Once every hold is placed, booking has started and neither the picks nor who pays for them can move. */
function backToReview(plan: PlanSnapshot, eventType: PlanEventType): TransitionResult {
  const wrongStatus = requireStatus(plan, ["reviewing", "approving"], eventType);
  if (wrongStatus) return wrongStatus;
  return succeed(reopenReview(plan), [
    ...releaseHolds(approvedMemberIds(plan)),
    { type: "request_review", memberIds: memberIdsOf(plan) },
  ]);
}

const handlers: HandlerMap = {
  review_started: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["draft"], event.type);
    if (wrongStatus) return wrongStatus;
    if (plan.members.length === 0) return fail("no_members", "A plan needs at least one member");
    return succeed({ ...plan, status: "reviewing" }, [{ type: "request_review", memberIds: memberIdsOf(plan) }]);
  },

  plan_agreed: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["reviewing"], event.type);
    if (wrongStatus) return wrongStatus;
    const member = findMember(plan, event.memberId);
    if (!member) return fail("unknown_member", `No member ${event.memberId}`);
    if (member.planAgreement !== "pending") {
      return fail("invalid_member_state", `Member has already ${member.planAgreement} the plan`);
    }
    if (!isNonNegativeInteger(event.shareMinor)) {
      return fail("invalid_amount", "The price the member saw must be a whole number of minor units");
    }
    const agreed = replaceMember(plan, { ...member, planAgreement: "agreed", agreedShareMinor: event.shareMinor });
    if (!agreed.members.every((candidate) => candidate.planAgreement === "agreed")) return succeed(agreed);
    // The last agreement opens step 2: each member now approves their amount.
    return succeed({ ...agreed, status: "approving" }, [{ type: "request_approval", memberIds: memberIdsOf(agreed) }]);
  },

  plan_declined: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["reviewing"], event.type);
    if (wrongStatus) return wrongStatus;
    if (!findMember(plan, event.memberId)) return fail("unknown_member", `No member ${event.memberId}`);
    // Nothing is held during review, so ending the plan releases nothing.
    return expire(plan);
  },

  picks_changed: (plan, event) => backToReview(plan, event.type),

  // Who pays what changed, so what everyone agreed to and approved is no longer what they will be asked for.
  covers_changed: (plan, event) => backToReview(plan, event.type),

  member_approved: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["approving"], event.type);
    if (wrongStatus) return wrongStatus;
    const member = findMember(plan, event.memberId);
    if (!member) return fail("unknown_member", `No member ${event.memberId}`);
    if (member.approval !== "pending" && member.approval !== "needs_reapproval") {
      return fail("invalid_member_state", `Member is already ${member.approval}`);
    }
    if (!isNonNegativeInteger(event.amountMinor)) {
      return fail("invalid_amount", "Approved amount must be a whole number of minor units");
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
    // Someone whose whole share is covered has nothing to hold. They are marked placed once their details are in.
    if (event.amountMinor === 0) return succeed(replaceMember(plan, approved));
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
    const wrongStatus = requireStatus(plan, ["reviewing", "approving", "held"], event.type);
    if (wrongStatus) return wrongStatus;
    const member = findMember(plan, event.memberId);
    if (!member) return fail("unknown_member", `No member ${event.memberId}`);
    if (!isNonNegativeInteger(event.currentMinor)) {
      return fail("invalid_amount", "Current price must be a whole number of minor units");
    }
    if (plan.status === "reviewing") return recheckDuringReview(plan, member, event.currentMinor);
    if (member.approval !== "approved" || member.approvedMinor === null) {
      return fail("invalid_member_state", "Member has no approved amount to compare against");
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
      // This member approved, so they have a hold to let go of; their new, higher amount needs a new one.
      ...releaseHolds([member.id]),
      { type: "request_reapproval", memberId: member.id, newAmountMinor: event.currentMinor },
    ]);
  },

  booking_started: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["held"], event.type);
    if (wrongStatus) return wrongStatus;
    if (event.at >= plan.deadlineAt) {
      return fail("deadline_reached", "The plan deadline has passed, so booking can no longer start");
    }
    return succeed({ ...plan, status: "booking" });
  },

  plan_replaced: (plan) => {
    if (plan.status === "booking" || plan.status === "booked") {
      return fail("booking_in_progress", "Booking has already started, so the plan can no longer be replaced");
    }
    const wrongStatus = requireStatus(plan, EXPIRABLE_PLAN_STATUSES, "plan_replaced");
    if (wrongStatus) return wrongStatus;
    return expire(plan);
  },

  booking_succeeded: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["booking"], event.type);
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
    const wrongStatus = requireStatus(plan, ["booking"], event.type);
    if (wrongStatus) return wrongStatus;
    return expire(plan);
  },

  member_charged: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["booked"], event.type);
    if (wrongStatus) return wrongStatus;
    const member = findMember(plan, event.memberId);
    if (!member) return fail("unknown_member", `No member ${event.memberId}`);
    if (!isNonNegativeInteger(event.chargedMinor) || member.approvedMinor === null || event.chargedMinor > member.approvedMinor) {
      return fail("invalid_amount", "A charge must be a whole number of minor units, no more than the person approved");
    }
    return succeed(replaceMember(plan, { ...member, chargedMinor: event.chargedMinor }));
  },

  capture_succeeded: (plan, event) => {
    const wrongStatus = requireStatus(plan, ["booked"], event.type);
    if (wrongStatus) return wrongStatus;
    return succeed({
      ...plan,
      status: "captured",
      // A charge already recorded as it happened stays as it was; the rest are what they owed.
      members: plan.members.map((member) => ({ ...member, chargedMinor: member.chargedMinor ?? member.currentShareMinor })),
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
