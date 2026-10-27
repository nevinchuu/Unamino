import { describe, expect, it } from "vitest";
import type { ConstraintSet } from "@/domain/constraints/schema";
import { computeMemberShares } from "@/domain/split/shares";
import { findConstraintViolations } from "./check-constraints";
import { toLineItems } from "./line-items";
import { BANGKOK_CONSTRAINTS, BANGKOK_OFFERS, FX, MEMBERS, MEMBER_IDS, NOW, WIREFRAME_PLAN, pick, withPicks } from "./test-support";
import { validatePlan, type ValidatedPlan } from "./validate";

const ALL = [...MEMBER_IDS];

function violationsFor(plan: ValidatedPlan, constraints: ConstraintSet, members = MEMBERS) {
  // A split refuses members with no cost, so price only the people the plan covers.
  const covered = members.filter((member) => plan.picks.some((p) => p.memberIds.includes(member.id)));
  const shares = computeMemberShares({ lineItems: toLineItems(plan), members: covered, fx: FX });
  if (!shares.ok) throw new Error(shares.error.message);
  return findConstraintViolations({ plan, constraints, shares: shares.value });
}

function planOf(picks: ReturnType<typeof pick>[]): ValidatedPlan {
  const result = validatePlan(withPicks(picks), { offers: BANGKOK_OFFERS, memberIds: MEMBER_IDS, requiredKinds: [], now: NOW });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const wireframe = (): ValidatedPlan => {
  const result = validatePlan(WIREFRAME_PLAN, { offers: BANGKOK_OFFERS, memberIds: MEMBER_IDS, requiredKinds: ["flight", "hotel"], now: NOW });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe("the wireframe plan against the wireframe constraints", () => {
  it("serves everyone: Ana's late flight, Ben at his cap, Jia alone and off cooking", () => {
    expect(violationsFor(wireframe(), BANGKOK_CONSTRAINTS)).toEqual([]);
  });
});

describe("flight departure windows", () => {
  it("flags the early flight for Ana, reading local time at the airport", () => {
    const plan = planOf([pick("fx-flt-early", ALL)]);
    const violations = violationsFor(plan, BANGKOK_CONSTRAINTS);
    expect(violations).toEqual([
      expect.objectContaining({ memberId: "ana", kind: "departure_window", offerId: "fx-flt-early" }),
    ]);
    expect(violations[0].message).toContain("13:05");
  });

  it("is inclusive at the edge", () => {
    const plan = planOf([pick("fx-flt-evening", ALL)]); // departs 20:10
    expect(violationsFor(plan, { ana: { outboundDeparture: { after: "20:10" } } })).toEqual([]);
    expect(violationsFor(plan, { ana: { outboundDeparture: { after: "20:11" } } })).toHaveLength(1);
  });

  it("checks the return flight separately, with a before limit", () => {
    const plan = planOf([pick("fx-flt-evening", ALL)]); // returns 21:30
    expect(violationsFor(plan, { ben: { returnDeparture: { before: "21:30" } } })).toEqual([]);
    const late = violationsFor(plan, { ben: { returnDeparture: { before: "20:00" } } });
    expect(late).toEqual([expect.objectContaining({ memberId: "ben", kind: "return_window" })]);
  });

  it("understands a window that runs overnight", () => {
    const plan = planOf([pick("fx-flt-evening", ALL)]); // departs 20:10
    expect(violationsFor(plan, { ana: { outboundDeparture: { after: "19:00", before: "02:00" } } })).toEqual([]);
    expect(violationsFor(plan, { ana: { outboundDeparture: { after: "22:00", before: "02:00" } } })).toHaveLength(1);
  });

  it("only checks the members who are on the flight", () => {
    const plan = planOf([pick("fx-act-market", ALL)]);
    expect(violationsFor(plan, { ana: { outboundDeparture: { after: "23:00" } } })).toEqual([]);
  });
});

describe("rooms and activities", () => {
  it("flags a shared room for someone who wants their own", () => {
    const plan = planOf([pick("fx-htl-triple", ["nevin", "ana", "ben"])]);
    const violations = violationsFor(plan, { ben: { ownRoom: true } });
    expect(violations).toEqual([expect.objectContaining({ memberId: "ben", kind: "own_room", offerId: "fx-htl-triple" })]);
  });

  it("accepts a single room for someone who wants their own", () => {
    expect(violationsFor(planOf([pick("fx-htl-single", ["jia"])]), { jia: { ownRoom: true } })).toEqual([]);
  });

  it("flags an activity the member said they would skip", () => {
    const plan = planOf([pick("fx-act-cooking", ["jia", "ben"])]);
    const violations = violationsFor(plan, BANGKOK_CONSTRAINTS);
    expect(violations).toEqual([expect.objectContaining({ memberId: "jia", kind: "skipped_activity", offerId: "fx-act-cooking" })]);
  });
});

describe("budget caps", () => {
  it("flags a share above the cap and reports it in money", () => {
    const violations = violationsFor(wireframe(), { ben: { budgetCap: { amountMinor: 34999, currency: "USD" } } });
    expect(violations).toEqual([expect.objectContaining({ memberId: "ben", kind: "budget_cap" })]);
    expect(violations[0].message).toContain("$350.00");
    expect(violations[0].message).toContain("$349.99");
  });

  it("accepts a share exactly at the cap", () => {
    expect(violationsFor(wireframe(), { ben: { budgetCap: { amountMinor: 35000, currency: "USD" } } })).toEqual([]);
  });

  it("compares in the member's own currency", () => {
    const sgdMembers = MEMBERS.map((member) => (member.id === "ben" ? { ...member, currency: "SGD" } : member));
    // Ben's $350 is 472.50 SGD
    expect(violationsFor(wireframe(), { ben: { budgetCap: { amountMinor: 47250, currency: "SGD" } } }, sgdMembers)).toEqual([]);
    expect(violationsFor(wireframe(), { ben: { budgetCap: { amountMinor: 47249, currency: "SGD" } } }, sgdMembers)).toHaveLength(1);
  });

  it("reports a cap in a different currency from what the member pays", () => {
    const violations = violationsFor(wireframe(), { ben: { budgetCap: { amountMinor: 50000, currency: "SGD" } } });
    expect(violations).toEqual([expect.objectContaining({ kind: "budget_cap" })]);
    expect(violations[0].message).toContain("SGD");
  });
});

describe("silent members", () => {
  it("have no constraints to break", () => {
    expect(violationsFor(wireframe(), {})).toEqual([]);
    expect(violationsFor(wireframe(), { nevin: {} })).toEqual([]);
  });
});
