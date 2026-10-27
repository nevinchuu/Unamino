import { describe, expect, it } from "vitest";
import type { ApprovalStatus, PlanAgreementStatus, PlanStatus } from "./statuses";
import { flight, hotel } from "./test-support";
import { buildPlanView, LIVE_PLAN_STATUSES } from "./view";
import type { PlanViewRaw, ViewIdea, ViewMember } from "./view-store";

const DEADLINE = new Date("2026-10-27T01:09:00.000Z");

const member = (id: string, name: string, overrides: Partial<ViewMember> = {}): ViewMember => ({ id, name, currency: "USD", planAgreement: "pending", approval: "pending", approvedMinor: null, holdPlaced: false, ...overrides });

const IDEA: ViewIdea = {
  id: "i1", date: "2026-12-12", startTime: "10:00", endTime: "12:00", category: "market", why: "Ana and Ben both like markets",
  venue: { placeId: "p1", name: "Chatuchak Weekend Market", address: "Kamphaeng Phet 2 Rd, Bangkok", mapsUrl: "https://maps.example/p1", businessStatus: "operational", hours: null },
};

function raw(overrides: Partial<PlanViewRaw> = {}): PlanViewRaw {
  return {
    id: "plan-1",
    groupId: "group-1",
    title: "Bangkok weekend",
    summary: "A shared room and the evening flight",
    status: "reviewing",
    deadlineAt: DEADLINE,
    baseCurrency: "USD",
    fx: { baseCurrency: "USD", source: "test", ratesPerBase: { SGD: 1.35 } },
    headcount: 2,
    replacedByPlanId: null,
    trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
    members: [member("ana", "Ana"), member("ben", "Ben")],
    picks: [
      { id: "pick-hotel", offer: hotel({ stars: 4, freeCancellationUntil: "2026-12-10T12:00:00Z", excludedCharges: [{ description: "City tax", amountMinor: 500, currency: "USD" }] }), memberIds: ["ana", "ben"], reason: "Fits the budget", notes: { ben: "own room" } },
      { id: "pick-flight", offer: flight(), memberIds: ["ana", "ben"], reason: "After 18:00 for Ana", notes: {} },
    ],
    ideas: [IDEA],
    ...overrides,
  };
}

const view = (overrides: Partial<PlanViewRaw> = {}, viewer = "ana") => buildPlanView(raw(overrides), viewer, { demoHolds: false });

describe("the plan as the screen shows it", () => {
  it("describes the trip, the status and the deadline", () => {
    expect(view()).toMatchObject({ id: "plan-1", groupId: "group-1", title: "Bangkok weekend", city: "Bangkok", dates: "Fri 11 Dec to Sun 13 Dec", headcount: 2, status: "reviewing", deadlineAt: "2026-10-27T01:09:00.000Z", currency: "USD", replacedBy: null });
  });

  it("lists flights before hotels, with who each is for and why", () => {
    const { items } = view();
    expect(items.map((item) => item.kind)).toEqual(["flight", "hotel"]);
    expect(items[0]).toMatchObject({ title: "SIN to BKK", memberNames: ["Ana", "Ben"], reason: "After 18:00 for Ana", totalMinor: 20_000, currency: "USD" });
  });

  it("writes a flight's legs with the times on the clock at each airport", () => {
    const flightItem = view().items[0];
    if (flightItem.kind !== "flight") throw new Error("expected a flight");
    expect(flightItem.legs).toEqual([{ direction: "outbound", route: "SIN to BKK", departs: "Fri 11 Dec, 20:10", arrives: "Fri 11 Dec, 21:35", carrier: "Scoot" }]);
    expect(flightItem.refundable).toBe(false);
  });

  it("writes a hotel's stay, stars, free cancellation, extra charges and what was done for each person", () => {
    const hotelItem = view().items[1];
    if (hotelItem.kind !== "hotel") throw new Error("expected a hotel");
    expect(hotelItem).toMatchObject({ roomName: "Twin", stay: "Fri 11 Dec to Sun 13 Dec · 2 nights", stars: 4, freeCancellationUntil: "Thu 10 Dec", extraCharges: [{ description: "City tax", minor: 500, currency: "USD" }], notes: [{ name: "Ben", text: "own room" }] });
  });

  it("shows free-time ideas with the details Google confirmed", () => {
    expect(view().ideas).toEqual([{ id: "i1", when: "Sat 12 Dec, 10:00 to 12:00", category: "market", name: "Chatuchak Weekend Market", address: "Kamphaeng Phet 2 Rd, Bangkok", mapsUrl: "https://maps.example/p1", why: "Ana and Ben both like markets" }]);
  });

  it("says when card holds are only pretended", () => {
    expect(buildPlanView(raw(), "ana", { demoHolds: true }).demoHolds).toBe(true);
  });
});

describe("who pays what", () => {
  it("gives each person their share and the parts it is made of", () => {
    const { people } = view();
    expect(people.map((p) => [p.name, p.shareMinor, p.isMe])).toEqual([["Ana", 30_000, true], ["Ben", 30_000, false]]);
    expect(people[0].lines).toEqual([{ label: "Riverside Hotel (Twin)", minor: 20_000 }, { label: "SIN to BKK", minor: 10_000 }]);
  });

  it("leaves out the parts for someone who pays in another currency, so they cannot disagree with the total", () => {
    const sgd = view({ members: [member("ana", "Ana", { currency: "SGD" }), member("ben", "Ben")] }).people[0];
    expect(sgd).toMatchObject({ shareMinor: 40_500, currency: "SGD", lines: [] });
  });

  it("shows no prices, and allows no agreeing, when the offers cannot be priced", () => {
    const unpriceable = view({ picks: [{ id: "p", offer: hotel({ currency: "SGD" }), memberIds: ["ana", "ben"], reason: "r", notes: {} }] });
    expect(unpriceable.pricesAvailable).toBe(false);
    expect(unpriceable.people.every((p) => p.shareMinor === null)).toBe(true);
    expect(unpriceable.me.actions.agree).toBe(false);
  });
});

describe("what a person may do", () => {
  const actionsFor = (status: PlanStatus, agreement: PlanAgreementStatus, approval: ApprovalStatus) =>
    view({ status, members: [member("ana", "Ana", { planAgreement: agreement, approval }), member("ben", "Ben")] }).me.actions;

  it("can agree or decline while the plan is being reviewed and they have not agreed", () => {
    expect(actionsFor("reviewing", "pending", "pending")).toEqual({ agree: true, decline: true, approve: false, declineAmount: false });
  });

  it("can only decline, to change their mind, once they have agreed", () => {
    expect(actionsFor("reviewing", "agreed", "pending")).toEqual({ agree: false, decline: true, approve: false, declineAmount: false });
  });

  it("can approve their amount, or decline, once everyone has agreed", () => {
    expect(actionsFor("approving", "agreed", "pending")).toEqual({ agree: false, decline: false, approve: true, declineAmount: true });
  });

  it("can approve again after their price rose past their cap", () => {
    expect(actionsFor("approving", "agreed", "needs_reapproval").approve).toBe(true);
  });

  it("has nothing to approve once they have", () => {
    expect(actionsFor("approving", "agreed", "approved")).toEqual({ agree: false, decline: false, approve: false, declineAmount: true });
  });

  it("can still back out while the holds are in, but not once booking has started or the plan has ended", () => {
    expect(actionsFor("held", "agreed", "approved").declineAmount).toBe(true);
    for (const status of ["booking", "booked", "captured", "expired"] as const) {
      expect(actionsFor(status, "agreed", "approved"), status).toEqual({ agree: false, decline: false, approve: false, declineAmount: false });
    }
  });

  it("cannot act on a plan made before they joined, but can look at it", () => {
    const late = view({}, "newcomer");
    expect(late.me).toMatchObject({ id: "newcomer", inPlan: false, agreement: null, approval: null, shareMinor: null, actions: { agree: false, decline: false, approve: false, declineAmount: false } });
    expect(late.people.some((p) => p.isMe)).toBe(false);
  });
});

describe("which states keep the screen checking", () => {
  it("are the ones where people are still deciding", () => {
    expect([...LIVE_PLAN_STATUSES].sort()).toEqual(["approving", "draft", "held", "reviewing"]);
  });
});
