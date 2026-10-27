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
  planAgreement: "agreed",
  agreedShareMinor: 20000,
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

/** Moves a held plan to booking, the way the booking runner claims it before calling the airline and hotel. */
const startBooking = (plan: PlanSnapshot): PlanSnapshot => run(plan, { type: "booking_started", at: minutes(2) }).plan;

const byId = (plan: PlanSnapshot, id: string): MemberSnapshot => {
  const found = plan.members.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
};

/** A plan in step 1: nobody has agreed yet. */
const reviewingPlan = (overrides: Partial<PlanSnapshot> = {}): PlanSnapshot =>
  planOf({
    status: "reviewing",
    members: [member("ana", { planAgreement: "pending", agreedShareMinor: null }), member("ben", { planAgreement: "pending", agreedShareMinor: null })],
    ...overrides,
  });

const agree = (plan: PlanSnapshot, memberId: string, shareMinor = 20000): PlanSnapshot =>
  run(plan, { type: "plan_agreed", at: minutes(1), memberId, shareMinor }).plan;

describe("starting the review", () => {
  it("moves a draft to reviewing and asks everyone to look", () => {
    const { plan, effects } = run(planOf({ status: "draft" }), { type: "review_started", at: T0 });
    expect(plan.status).toBe("reviewing");
    expect(effects).toEqual([{ type: "request_review", memberIds: ["ana", "ben"] }]);
  });

  it("needs members and a draft", () => {
    expect(errorCode(planOf({ status: "draft", members: [] }), { type: "review_started", at: T0 })).toBe("no_members");
    expect(errorCode(planOf(), { type: "review_started", at: T0 })).toBe("invalid_status");
  });
});

describe("step 1: agreeing to the plan", () => {
  it("records what the member saw and stays in review until everyone agrees", () => {
    const plan = agree(reviewingPlan(), "ana", 19500);
    expect(plan.status).toBe("reviewing");
    expect(byId(plan, "ana")).toMatchObject({ planAgreement: "agreed", agreedShareMinor: 19500 });
    expect(byId(plan, "ben").planAgreement).toBe("pending");
  });

  it("opens step 2 when the last member agrees, without asking for a card", () => {
    const { plan, effects } = run(agree(reviewingPlan(), "ana"), { type: "plan_agreed", at: minutes(2), memberId: "ben", shareMinor: 15000 });
    expect(plan.status).toBe("approving");
    expect(effects).toEqual([{ type: "request_approval", memberIds: ["ana", "ben"] }]);
    expect(plan.members.every((m) => m.approval === "pending" && !m.holdPlaced)).toBe(true);
  });

  it("rejects bad input", () => {
    const base = reviewingPlan();
    expect(errorCode(base, { type: "plan_agreed", at: T0, memberId: "ghost", shareMinor: 100 })).toBe("unknown_member");
    expect(errorCode(base, { type: "plan_agreed", at: T0, memberId: "ana", shareMinor: 0 })).toBe("invalid_amount");
    expect(errorCode(base, { type: "plan_agreed", at: T0, memberId: "ana", shareMinor: 10.5 })).toBe("invalid_amount");
    expect(errorCode(planOf(), { type: "plan_agreed", at: T0, memberId: "ana", shareMinor: 100 })).toBe("invalid_status");
  });

  it("does not let a member agree twice", () => {
    expect(errorCode(agree(reviewingPlan(), "ana"), { type: "plan_agreed", at: T0, memberId: "ana", shareMinor: 100 })).toBe("invalid_member_state");
  });

  it("does not take approvals before step 1 is done", () => {
    expect(errorCode(reviewingPlan(), { type: "member_approved", at: minutes(1), memberId: "ana", amountMinor: 20000, expiresAt: DEADLINE })).toBe("invalid_status");
  });

  it("expires the plan with nothing to release when a member declines it", () => {
    const { plan, effects } = run(agree(reviewingPlan(), "ana"), { type: "plan_declined", at: minutes(2), memberId: "ben" });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([]);
  });

  it("only lets a member decline the plan during review", () => {
    expect(errorCode(planOf(), { type: "plan_declined", at: T0, memberId: "ana" })).toBe("invalid_status");
    expect(errorCode(reviewingPlan(), { type: "plan_declined", at: T0, memberId: "ghost" })).toBe("unknown_member");
  });
});

describe("changing the picks", () => {
  it("sends everyone back to review and clears their agreements", () => {
    const { plan, effects } = run(agree(reviewingPlan(), "ana"), { type: "picks_changed", at: minutes(2) });
    expect(plan.status).toBe("reviewing");
    expect(plan.members.every((m) => m.planAgreement === "pending" && m.agreedShareMinor === null)).toBe(true);
    expect(effects).toEqual([{ type: "request_review", memberIds: ["ana", "ben"] }]);
  });

  it("also undoes approvals and releases the holds that exist", () => {
    const partial = approveAndHold(planOf(), "ana", 20000);
    const { plan, effects } = run(partial, { type: "picks_changed", at: minutes(2) });
    expect(plan.status).toBe("reviewing");
    expect(byId(plan, "ana")).toMatchObject({ approval: "pending", approvedMinor: null, holdPlaced: false, approvalExpiresAt: null });
    expect(effects).toEqual([
      { type: "release_holds", memberIds: ["ana"] },
      { type: "request_review", memberIds: ["ana", "ben"] },
    ]);
  });

  it("is refused once every hold is placed and booking has started", () => {
    expect(errorCode(heldPlan(), { type: "picks_changed", at: minutes(2) })).toBe("invalid_status");
    expect(errorCode(planOf({ status: "booked" }), { type: "picks_changed", at: minutes(2) })).toBe("invalid_status");
  });
});

describe("a price rise during review", () => {
  /** Ana has agreed having seen `shareMinor`; Ben has not agreed yet. */
  const anaAgreedAt = (shareMinor: number): PlanSnapshot =>
    reviewingPlan({ members: [member("ana", { agreedShareMinor: shareMinor }), member("ben", { planAgreement: "pending", agreedShareMinor: null })] });
  const recheck = (plan: PlanSnapshot, currentMinor: number) => run(plan, { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor });

  it("leaves the plan alone when the price is the same, lower, or up by no more than 5%", () => {
    const plan = anaAgreedAt(20000);
    for (const current of [19000, 20000, 21000]) {
      const result = recheck(plan, current);
      expect(result.plan).toBe(plan);
      expect(result.effects).toEqual([]);
    }
  });

  it("sends everyone back to review for a rise above 5%", () => {
    const { plan, effects } = recheck(anaAgreedAt(20000), 21001);
    expect(plan.status).toBe("reviewing");
    expect(plan.members.every((m) => m.planAgreement === "pending" && m.agreedShareMinor === null)).toBe(true);
    expect(effects).toEqual([{ type: "request_review", memberIds: ["ana", "ben"] }]);
  });

  it("measures against what the member saw, so small rises cannot add up", () => {
    const plan = anaAgreedAt(20000);
    expect(recheck(plan, 20800).plan).toBe(plan);
    expect(recheck(plan, 21400).plan.members.every((m) => m.planAgreement === "pending")).toBe(true);
  });

  it("has nothing to compare for a member who has not agreed yet", () => {
    const plan = reviewingPlan();
    expect(run(plan, { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 99999 }).plan).toBe(plan);
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

    const booked = run(startBooking(rechecked.plan), { type: "booking_succeeded", at: minutes(3) });
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
    const booked = run(startBooking(heldPlan()), { type: "booking_succeeded", at: minutes(3) });
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

  it("lets go of the hold of someone who approved but never added their card, when their price passes their cap", () => {
    // The hold is made when they approve, so it exists even though no card is on it yet, and a new amount needs a new one.
    const approvedOnly = run(planOf(), { type: "member_approved", at: minutes(1), memberId: "ana", amountMinor: 20000, expiresAt: DEADLINE }).plan;
    const { effects } = run(approvedOnly, { type: "price_rechecked", at: minutes(2), memberId: "ana", currentMinor: 25000 });
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana"] }, { type: "request_reapproval", memberId: "ana", newAmountMinor: 25000 }]);
  });

  it("lets go of the holds of everyone who approved when the plan ends, card added or not, and of nobody who has not", () => {
    const approvedOnly = run(planOf(), { type: "member_approved", at: minutes(1), memberId: "ana", amountMinor: 20000, expiresAt: DEADLINE }).plan;
    const { effects } = run(approvedOnly, { type: "member_declined", at: minutes(2), memberId: "ben" });
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana"] }]);
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
    // Held is not enough: booking has to be claimed first.
    expect(errorCode(heldPlan(), { type: "booking_succeeded", at: minutes(3) })).toBe("invalid_status");
  });

  it("refuses to charge after the deadline", () => {
    expect(errorCode(startBooking(heldPlan()), { type: "booking_succeeded", at: DEADLINE })).toBe("deadline_reached");
  });

  it("refuses to charge if a share is above its cap", () => {
    const held = startBooking(heldPlan());
    const broken: PlanSnapshot = { ...held, members: held.members.map((m) => (m.id === "ana" ? { ...m, currentShareMinor: 20001 } : m)) };
    expect(errorCode(broken, { type: "booking_succeeded", at: minutes(3) })).toBe("invalid_member_state");
  });

  it("expires the plan and releases every hold when booking fails", () => {
    const { plan, effects } = run(startBooking(heldPlan()), { type: "booking_failed", at: minutes(3) });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana", "ben"] }]);
  });

  it("only fails a plan that is booking", () => {
    expect(errorCode(heldPlan(), { type: "booking_failed", at: minutes(3) })).toBe("invalid_status");
  });

  it("only captures a booked plan", () => {
    expect(errorCode(heldPlan(), { type: "capture_succeeded", at: minutes(3) })).toBe("invalid_status");
  });
});

describe("starting to book", () => {
  it("moves a held plan to booking without charging anyone", () => {
    const { plan, effects } = run(heldPlan(), { type: "booking_started", at: minutes(2) });
    expect(plan.status).toBe("booking");
    expect(effects).toEqual([]);
    expect(plan.members.every((m) => m.holdPlaced)).toBe(true);
  });

  it("only starts once everyone is held", () => {
    expect(errorCode(planOf(), { type: "booking_started", at: minutes(1) })).toBe("invalid_status");
    expect(errorCode(reviewingPlan(), { type: "booking_started", at: minutes(1) })).toBe("invalid_status");
    expect(errorCode(startBooking(heldPlan()), { type: "booking_started", at: minutes(2) })).toBe("invalid_status");
  });

  it("refuses to start at or after the deadline", () => {
    expect(errorCode(heldPlan(), { type: "booking_started", at: DEADLINE })).toBe("deadline_reached");
    expect(errorCode(heldPlan(), { type: "booking_started", at: minutes(8) })).toBeNull();
  });

  it("cannot be ended by the deadline, a lost listing, a decline or a price check once it has started", () => {
    const booking = startBooking(heldPlan());
    expect(errorCode(booking, { type: "deadline_passed", at: HARD })).toBe("invalid_status");
    expect(errorCode(booking, { type: "offers_unavailable", at: minutes(3) })).toBe("invalid_status");
    expect(errorCode(booking, { type: "member_declined", at: minutes(3), memberId: "ana" })).toBe("invalid_status");
    expect(errorCode(booking, { type: "price_rechecked", at: minutes(3), memberId: "ana", currentMinor: 1000 })).toBe("invalid_status");
    expect(errorCode(booking, { type: "picks_changed", at: minutes(3) })).toBe("invalid_status");
  });

  it("is not part of the refresh and overdue checks", () => {
    const booking = startBooking(heldPlan());
    expect(needsOfferRefresh(booking, DEADLINE)).toBe(false);
    expect(isPlanOverdue(booking, HARD)).toBe(false);
  });
});

describe("replacing the plan", () => {
  it("expires a plan in review with nothing to release", () => {
    const { plan, effects } = run(agree(reviewingPlan(), "ana"), { type: "plan_replaced", at: minutes(2) });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([]);
  });

  it("releases only the holds that exist while approving", () => {
    const { plan, effects } = run(approveAndHold(planOf(), "ana", 20000), { type: "plan_replaced", at: minutes(2) });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana"] }]);
  });

  it("is allowed while held, before booking starts, and releases every hold", () => {
    const { plan, effects } = run(heldPlan(), { type: "plan_replaced", at: minutes(2) });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([{ type: "release_holds", memberIds: ["ana", "ben"] }]);
  });

  it("is refused once booking has started, because bookings may already exist", () => {
    expect(errorCode(startBooking(heldPlan()), { type: "plan_replaced", at: minutes(3) })).toBe("booking_in_progress");
    expect(errorCode(planOf({ status: "booked" }), { type: "plan_replaced", at: minutes(3) })).toBe("booking_in_progress");
  });

  it("is refused once the plan has ended", () => {
    for (const status of ["captured", "expired"] as const) {
      expect(errorCode(planOf({ status }), { type: "plan_replaced", at: minutes(3) })).toBe("plan_closed");
    }
  });

  it("works on a draft", () => {
    expect(run(planOf({ status: "draft" }), { type: "plan_replaced", at: T0 }).plan.status).toBe("expired");
  });
});

describe("terminal plans", () => {
  it.each(["captured", "expired"] as const)("accepts no events once %s", (status) => {
    expect(errorCode(planOf({ status }), { type: "review_started", at: T0 })).toBe("plan_closed");
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

describe("deadlines during review", () => {
  it("expires a plan in review at the deadline with nothing to release", () => {
    const { plan, effects } = run(reviewingPlan(), { type: "deadline_passed", at: DEADLINE });
    expect(plan.status).toBe("expired");
    expect(effects).toEqual([]);
  });

  it("extends the deadline and keeps agreements", () => {
    const { plan } = run(agree(reviewingPlan(), "ana"), { type: "deadline_extended", at: DEADLINE, newDeadlineAt: minutes(18) });
    expect(plan.deadlineAt).toEqual(minutes(18));
    expect(byId(plan, "ana").planAgreement).toBe("agreed");
  });

  it("ends the plan when a listing is lost, and still checks for refresh and overdue", () => {
    expect(run(reviewingPlan(), { type: "offers_unavailable", at: T0 }).plan.status).toBe("expired");
    expect(needsOfferRefresh(reviewingPlan(), DEADLINE)).toBe(true);
    expect(isPlanOverdue(reviewingPlan(), HARD)).toBe(true);
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
