import { describe, expect, it } from "vitest";
import { isPlanOverdue, needsOfferRefresh } from "./overdue";
import { transition } from "./transition";
import type { MemberSnapshot, PlanEffect, PlanEvent, PlanSnapshot } from "./types";

const T0 = new Date("2026-10-27T00:00:00Z");
const DEADLINE = new Date("2026-10-27T00:09:00Z");
const HARD = new Date("2026-10-29T00:00:00Z");
const minutes = (n: number): Date => new Date(T0.getTime() + n * 60_000);

const member = (id: string, overrides: Partial<MemberSnapshot> = {}): MemberSnapshot => ({
  id,
  approval: "pending",
  approvedMinor: null,
  currentShareMinor: null,
  chargedMinor: null,
  approvalExpiresAt: null,
  holdPlaced: false,
  ...overrides,
});

const planOf = (overrides: Partial<PlanSnapshot> = {}): PlanSnapshot => ({
  status: "approving",
  deadlineAt: DEADLINE,
  hardDeadlineAt: HARD,
  members: [member("ana"), member("ben")],
  ...overrides,
});

function run(plan: PlanSnapshot, event: PlanEvent): { plan: PlanSnapshot; effects: readonly PlanEffect[] } {
  const result = transition(plan, event);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

const errorCode = (plan: PlanSnapshot, event: PlanEvent): string | null => {
  const result = transition(plan, event);
  return result.ok ? null : result.error.code;
};

/** Approves a member for `amountMinor` and places their hold. */
function approveAndHold(plan: PlanSnapshot, memberId: string, amountMinor: number): PlanSnapshot {
  const approved = run(plan, { type: "member_approved", at: minutes(1), memberId, amountMinor, expiresAt: plan.deadlineAt });
  return run(approved.plan, { type: "hold_placed", at: minutes(1), memberId }).plan;
}

const heldPlan = (anaMinor = 20000, benMinor = 15000): PlanSnapshot =>
  approveAndHold(approveAndHold(planOf(), "ana", anaMinor), "ben", benMinor);

const byId = (plan: PlanSnapshot, id: string): MemberSnapshot => {
  const found = plan.members.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
};

describe("starting approval", () => {
  it("moves a draft to approving", () => {
    expect(run(planOf({ status: "draft" }), { type: "approval_started", at: T0 }).plan.status).toBe("approving");
  });

  it("needs members and a draft", () => {
    expect(errorCode(planOf({ status: "draft", members: [] }), { type: "approval_started", at: T0 })).toBe("no_members");
    expect(errorCode(planOf(), { type: "approval_started", at: T0 })).toBe("invalid_status");
  });
});

describe("approving", () => {
  const approve = (overrides: Partial<Extract<PlanEvent, { type: "member_approved" }>> = {}): PlanEvent => ({
    type: "member_approved", at: minutes(1), memberId: "ana", amountMinor: 20000, expiresAt: DEADLINE, ...overrides,
  });

  it("records the approved amount as the cap and asks for a hold of that amount", () => {
    const { plan, effects } = run(planOf(), approve());
    expect(byId(plan, "ana")).toMatchObject({ approval: "approved", approvedMinor: 20000, currentShareMinor: 20000, holdPlaced: false });
    expect(effects).toEqual([{ type: "place_hold", memberId: "ana", amountMinor: 20000 }]);
  });

  it("rejects bad input", () => {
    expect(errorCode(planOf(), approve({ memberId: "ghost" }))).toBe("unknown_member");
    expect(errorCode(planOf(), approve({ amountMinor: 0 }))).toBe("invalid_amount");
    expect(errorCode(planOf(), approve({ amountMinor: 10.5 }))).toBe("invalid_amount");
    expect(errorCode(planOf(), approve({ expiresAt: minutes(1) }))).toBe("invalid_expiry");
    expect(errorCode(planOf(), approve({ expiresAt: minutes(10) }))).toBe("invalid_expiry");
    expect(errorCode(planOf({ status: "draft" }), approve())).toBe("invalid_status");
  });

  it("does not let a member approve twice", () => {
    const once = run(planOf(), approve()).plan;
    expect(errorCode(once, approve())).toBe("invalid_member_state");
  });

  it("books only when every member is approved and held", () => {
    const half = approveAndHold(planOf(), "ana", 20000);
    expect(half.status).toBe("approving");

    const approvedBen = run(half, { type: "member_approved", at: minutes(1), memberId: "ben", amountMinor: 15000, expiresAt: DEADLINE }).plan;
    const last = run(approvedBen, { type: "hold_placed", at: minutes(1), memberId: "ben" });
    expect(last.plan.status).toBe("held");
    expect(last.effects).toEqual([{ type: "book" }]);
  });

  it("needs an approval before a hold, and only one hold", () => {
    expect(errorCode(planOf(), { type: "hold_placed", at: T0, memberId: "ana" })).toBe("invalid_member_state");
    const held = approveAndHold(planOf(), "ana", 20000);
    expect(errorCode(held, { type: "hold_placed", at: T0, memberId: "ana" })).toBe("invalid_member_state");
  });
});

describe("declining", () => {
  it("expires the plan and releases only the holds that exist", () => {
    const partial = approveAndHold(planOf(), "ana", 20000);
    const { plan, effects } = run(partial, { type: "member_declined", at: minutes(2), memberId: "ben" });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana"] }]);
  });

  it("has nothing to release when no hold was placed", () => {
    expect(run(planOf(), { type: "member_declined", at: T0, memberId: "ana" }).effects).toEqual([]);
  });

  it("is refused for an unknown member or a booked plan", () => {
    expect(errorCode(planOf(), { type: "member_declined", at: T0, memberId: "ghost" })).toBe("unknown_member");
    expect(errorCode(planOf({ status: "booked" }), { type: "member_declined", at: T0, memberId: "ana" })).toBe("invalid_status");
  });
});

describe("the cap: charged is never more than approved", () => {
  it("keeps the leftover with the member: Ana approves 200, owes 195, is charged 195 and gets 5 back", () => {
    const held = heldPlan(20000, 15000);
    const rechecked = run(held, { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 19500 });
    expect(rechecked.effects).toEqual([]);
    expect(byId(rechecked.plan, "ana")).toMatchObject({ approvedMinor: 20000, currentShareMinor: 19500, approval: "approved" });

    const booked = run(rechecked.plan, { type: "booking_succeeded", at: minutes(3) });
    expect(booked.plan.status).toBe("booked");
    expect(booked.effects).toEqual([
      {
        type: "capture_holds",
        captures: [
          { memberId: "ana", captureMinor: 19500, releaseMinor: 500 },
          { memberId: "ben", captureMinor: 15000, releaseMinor: 0 },
        ],
      },
    ]);

    const captured = run(booked.plan, { type: "capture_succeeded", at: minutes(4) }).plan;
    expect(captured.status).toBe("captured");
    expect(byId(captured, "ana").chargedMinor).toBe(19500);
    expect(byId(captured, "ben").chargedMinor).toBe(15000);
  });

  it("charges the full cap when the price did not change", () => {
    const booked = run(heldPlan(), { type: "booking_succeeded", at: minutes(3) });
    expect(booked.effects[0]).toMatchObject({
      captures: [{ captureMinor: 20000, releaseMinor: 0 }, { captureMinor: 15000, releaseMinor: 0 }],
    });
  });

  it("leaves everyone else unchanged when one price falls and then rises back within the cap", () => {
    const lower = run(heldPlan(), { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 19000 }).plan;
    const back = run(lower, { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 20000 }).plan;
    expect(byId(back, "ana").currentShareMinor).toBe(20000);
    expect(byId(back, "ben")).toEqual(byId(heldPlan(), "ben"));
  });

  it("does nothing when the recheck matches the current share", () => {
    const held = heldPlan();
    expect(run(held, { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 20000 }).plan).toBe(held);
  });

  it("sends only the affected member back when the price passes their cap", () => {
    const { plan, effects } = run(heldPlan(), { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 20001 });
    expect(plan.status).toBe("approving");
    expect(byId(plan, "ana")).toMatchObject({ approval: "needs_reapproval", approvedMinor: null, currentShareMinor: null, holdPlaced: false });
    expect(byId(plan, "ben")).toMatchObject({ approval: "approved", approvedMinor: 15000, holdPlaced: true });
    expect(effects).toEqual([
      { type: "release_holds", memberIds: ["ana"] },
      { type: "request_reapproval", memberId: "ana", newAmountMinor: 20001 },
    ]);
  });

  it("does not release a hold that was never placed", () => {
    const approvedOnly = run(planOf(), { type: "member_approved", at: minutes(1), memberId: "ana", amountMinor: 20000, expiresAt: DEADLINE }).plan;
    const { effects } = run(approvedOnly, { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 25000 });
    expect(effects).toEqual([{ type: "request_reapproval", memberId: "ana", newAmountMinor: 25000 }]);
  });

  it("lets the member approve the higher amount and books again once they are held", () => {
    const reopened = run(heldPlan(), { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 21000 }).plan;
    const reapproved = run(reopened, { type: "member_approved", at: minutes(3), memberId: "ana", amountMinor: 21000, expiresAt: DEADLINE }).plan;
    const done = run(reapproved, { type: "hold_placed", at: minutes(3), memberId: "ana" });
    expect(done.plan.status).toBe("held");
    expect(done.effects).toEqual([{ type: "book" }]);
  });

  it("expires the plan if the member declines the higher amount", () => {
    const reopened = run(heldPlan(), { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 21000 }).plan;
    const declined = run(reopened, { type: "member_declined", at: minutes(3), memberId: "ana" });
    expect(declined.plan.status).toBe("expired");
    expect(declined.effects).toEqual([{ type: "release_holds", memberIds: ["ben"] }]);
  });

  it("rejects a recheck it cannot compare", () => {
    expect(errorCode(heldPlan(), { type: "price_rechecked", at: T0, memberId: "ghost", currentMinor: 1 })).toBe("unknown_member");
    expect(errorCode(heldPlan(), { type: "price_rechecked", at: T0, memberId: "ana", currentMinor: 0 })).toBe("invalid_amount");
    expect(errorCode(planOf(), { type: "price_rechecked", at: T0, memberId: "ana", currentMinor: 100 })).toBe("invalid_member_state");
  });
});

describe("booking", () => {
  it("only books a held plan", () => {
    expect(errorCode(planOf(), { type: "booking_succeeded", at: minutes(1) })).toBe("invalid_status");
  });

  it("refuses to charge after the deadline", () => {
    expect(errorCode(heldPlan(), { type: "booking_succeeded", at: DEADLINE })).toBe("deadline_reached");
  });

  it("refuses to charge if a share is above its cap", () => {
    const held = heldPlan();
    const broken: PlanSnapshot = { ...held, members: held.members.map((m) => (m.id === "ana" ? { ...m, currentShareMinor: 20001 } : m)) };
    expect(errorCode(broken, { type: "booking_succeeded", at: minutes(3) })).toBe("invalid_member_state");
  });

  it("expires the plan and releases every hold when booking fails", () => {
    const { plan, effects } = run(heldPlan(), { type: "booking_failed", at: minutes(3) });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana", "ben"] }]);
  });

  it("only captures a booked plan", () => {
    expect(errorCode(heldPlan(), { type: "capture_succeeded", at: minutes(3) })).toBe("invalid_status");
  });
});

describe("terminal plans", () => {
  it.each(["captured", "expired"] as const)("accepts no events once %s", (status) => {
    expect(errorCode(planOf({ status }), { type: "approval_started", at: T0 })).toBe("plan_closed");
    expect(errorCode(planOf({ status }), { type: "deadline_passed", at: HARD })).toBe("plan_closed");
  });
});

describe("deadlines", () => {
  it("expires at the deadline and releases holds, but not before it", () => {
    expect(errorCode(heldPlan(), { type: "deadline_passed", at: minutes(8) })).toBe("deadline_not_reached");
    const { plan, effects } = run(heldPlan(), { type: "deadline_passed", at: DEADLINE });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana", "ben"] }]);
  });

  it("cannot expire a booked plan", () => {
    expect(errorCode(planOf({ status: "booked" }), { type: "deadline_passed", at: HARD })).toBe("invalid_status");
  });

  it("extends the deadline and moves approvals with it", () => {
    const newDeadline = minutes(18);
    const { plan, effects } = run(heldPlan(), { type: "deadline_extended", at: DEADLINE, newDeadlineAt: newDeadline });
    expect(plan.deadlineAt).toEqual(newDeadline);
    expect(plan.members.every((m) => m.approvalExpiresAt?.getTime() === newDeadline.getTime())).toBe(true);
    expect(effects).toEqual([]);
  });

  it("leaves a pending member's approval alone when extending", () => {
    const { plan } = run(planOf(), { type: "deadline_extended", at: DEADLINE, newDeadlineAt: minutes(18) });
    expect(plan.members.every((m) => m.approvalExpiresAt === null)).toBe(true);
  });

  it("refuses to extend backwards, to the same time, or past the hard cap", () => {
    expect(errorCode(heldPlan(), { type: "deadline_extended", at: T0, newDeadlineAt: minutes(5) })).toBe("invalid_deadline");
    expect(errorCode(heldPlan(), { type: "deadline_extended", at: T0, newDeadlineAt: DEADLINE })).toBe("invalid_deadline");
    expect(errorCode(heldPlan(), { type: "deadline_extended", at: T0, newDeadlineAt: new Date(HARD.getTime() + 1) })).toBe("invalid_deadline");
  });

  it("allows extending exactly to the hard cap", () => {
    expect(run(heldPlan(), { type: "deadline_extended", at: T0, newDeadlineAt: HARD }).plan.deadlineAt).toEqual(HARD);
  });

  it("ends the plan and releases holds when a listing is lost", () => {
    const { plan, effects } = run(heldPlan(), { type: "offers_unavailable", at: minutes(2) });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana", "ben"] }]);
  });

  it("does not end a booked plan when a listing is lost", () => {
    expect(errorCode(planOf({ status: "booked" }), { type: "offers_unavailable", at: T0 })).toBe("invalid_status");
  });
});

describe("overdue and refresh checks", () => {
  it("needs a refresh after the deadline but before the hard cap", () => {
    expect(needsOfferRefresh(planOf(), minutes(5))).toBe(false);
    expect(needsOfferRefresh(planOf(), DEADLINE)).toBe(true);
    expect(needsOfferRefresh(planOf(), HARD)).toBe(false);
  });

  it("is overdue at the hard cap", () => {
    expect(isPlanOverdue(planOf(), new Date(HARD.getTime() - 1))).toBe(false);
    expect(isPlanOverdue(planOf(), HARD)).toBe(true);
  });

  it("never touches a booked or finished plan", () => {
    for (const status of ["booked", "captured", "expired"] as const) {
      expect(isPlanOverdue(planOf({ status }), HARD)).toBe(false);
      expect(needsOfferRefresh(planOf({ status }), DEADLINE)).toBe(false);
    }
  });
});
