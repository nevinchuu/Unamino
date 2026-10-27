import { describe, expect, it } from "vitest";
import type { Offer } from "@/domain/offers/schema";
import { toLineItems } from "./line-items";
import { BANGKOK_OFFERS, MEMBER_IDS, NOW, WIREFRAME_PLAN, pick, withPicks } from "./test-support";
import { validatePlan, type PlanContext } from "./validate";

const context: PlanContext = {
  offers: BANGKOK_OFFERS,
  memberIds: MEMBER_IDS,
  requiredKinds: ["flight", "hotel"],
  now: NOW,
};

const ALL = [...MEMBER_IDS];

const errorOf = (picks: ReturnType<typeof pick>[], overrides: Partial<PlanContext> = {}) => {
  const result = validatePlan(withPicks(picks), { ...context, ...overrides });
  return result.ok ? null : result.error;
};

describe("validatePlan: the wireframe plan", () => {
  const result = validatePlan(WIREFRAME_PLAN, context);
  if (!result.ok) throw new Error(result.error.message);

  it("is valid and priced as the sum of its offers", () => {
    expect(result.value.totalMinor).toBe(72000 + 42000 + 20000 + 12000 + 9000);
    expect(result.value.currency).toBe("USD");
    expect(result.value.picks.map((p) => p.offer.id)).toEqual(["fx-flt-evening", "fx-htl-triple", "fx-htl-single", "fx-act-market", "fx-act-cooking"]);
  });

  it("keeps who each offer is for, with the planner's notes", () => {
    const triple = result.value.picks[1];
    expect(triple.memberIds).toEqual(["nevin", "ana", "ben"]);
    expect(triple.notes.ana).toBe("Works for them");
  });

  it("turns picks into line items shared by exactly their members", () => {
    const items = toLineItems(result.value);
    expect(items.map((item) => item.totalMinor)).toEqual([72000, 42000, 20000, 12000, 9000]);
    expect(items[1].allocation).toEqual({ type: "equal", memberIds: ["nevin", "ana", "ben"] });
    expect(items[1].label).toBe("Riverside hotel, 2 nights (Triple room)");
  });

  it("lets two rooms share the same dates because they are for different people", () => {
    expect(result.ok).toBe(true);
  });
});

describe("validatePlan: rejections", () => {
  it("rejects an offer that was not in the search", () => {
    expect(errorOf([pick("made-up", ALL)])).toMatchObject({ code: "unknown_offer", offerIds: ["made-up"] });
  });

  it("rejects the same offer picked twice", () => {
    expect(errorOf([pick("fx-flt-evening", ALL), pick("fx-flt-evening", ALL)])).toMatchObject({ code: "duplicate_pick" });
  });

  it("rejects unknown and repeated members", () => {
    expect(errorOf([pick("fx-act-cooking", ["nevin", "zed"])])).toMatchObject({ code: "unknown_member", memberIds: ["zed"] });
    expect(errorOf([pick("fx-act-cooking", ["nevin", "nevin"])])).toMatchObject({ code: "duplicate_member" });
  });

  it("rejects a member count that does not match what the offer is priced for", () => {
    expect(errorOf([pick("fx-htl-triple", ["nevin", "ana"])])).toMatchObject({ code: "guests_mismatch", offerIds: ["fx-htl-triple"] });
    expect(errorOf([pick("fx-flt-evening", ["nevin"])])).toMatchObject({ code: "guests_mismatch" });
  });

  it("rejects an unknown member in a compromise", () => {
    const output = { ...WIREFRAME_PLAN, compromises: [{ memberId: "zed", note: "x" }] };
    const result = validatePlan(output, context);
    expect(result.ok ? null : result.error.code).toBe("unknown_member");
  });

  it("rejects expired offers", () => {
    const later = new Date(NOW.getTime() + 10 * 60_000);
    expect(errorOf(WIREFRAME_PLAN.picks, { now: later })).toMatchObject({ code: "expired_offer", offerIds: ["fx-flt-evening"] });
  });

  it("rejects mixed currencies", () => {
    const sgd: Offer[] = BANGKOK_OFFERS.map((offer) => (offer.id === "fx-act-market" ? { ...offer, currency: "SGD" } : offer));
    expect(errorOf(WIREFRAME_PLAN.picks, { offers: sgd })).toMatchObject({ code: "mixed_currency" });
  });

  it("rejects a member in two hotels on overlapping dates", () => {
    const clone: Offer = { ...(BANGKOK_OFFERS.find((o) => o.id === "fx-htl-single") as Offer), id: "fx-htl-single-2" };
    const result = errorOf(
      [pick("fx-flt-evening", ALL), pick("fx-htl-triple", ["nevin", "ana", "ben"]), pick("fx-htl-single-2", ["nevin"]), pick("fx-htl-single", ["jia"])],
      { offers: [...BANGKOK_OFFERS, clone] },
    );
    expect(result).toMatchObject({ code: "overlapping_hotels", memberIds: ["nevin"] });
  });

  it("rejects a member on two flights that overlap", () => {
    const clone: Offer = { ...(BANGKOK_OFFERS.find((o) => o.id === "fx-flt-evening") as Offer), id: "fx-flt-evening-2", guests: 1 } as Offer;
    const picks = [pick("fx-flt-evening", ALL), pick("fx-flt-evening-2", ["ana"]), pick("fx-htl-triple", ["nevin", "ana", "ben"]), pick("fx-htl-single", ["jia"])];
    expect(errorOf(picks, { offers: [...BANGKOK_OFFERS, clone] })).toMatchObject({ code: "overlapping_flights", memberIds: ["ana"] });
  });

  it("rejects a plan where someone has no flight or no stay", () => {
    expect(errorOf([pick("fx-htl-triple", ["nevin", "ana", "ben"]), pick("fx-htl-single", ["jia"])])).toMatchObject({
      code: "member_not_covered",
      memberIds: [...MEMBER_IDS],
    });
    expect(errorOf([pick("fx-flt-evening", ALL), pick("fx-htl-triple", ["nevin", "ana", "ben"])])).toMatchObject({
      code: "member_not_covered",
      memberIds: ["jia"],
    });
  });

  it("only requires the kinds the caller asks for", () => {
    const result = validatePlan(withPicks([pick("fx-act-market", ALL)]), { ...context, requiredKinds: [] });
    expect(result.ok).toBe(true);
  });
});
