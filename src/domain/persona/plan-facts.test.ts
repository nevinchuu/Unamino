import { describe, expect, it } from "vitest";
import { flight, hotel } from "@/domain/plan/test-support";
import type { PlanViewRaw, ViewMember } from "@/domain/plan/view-store";
import { planBriefFor, planFactsFor } from "./plan-facts";

const NOW = new Date("2026-11-01T00:00:00Z");
const member = (id: string, name: string): ViewMember => ({ id, name, currency: "USD", planAgreement: "pending", approval: "pending", approvedMinor: null, chargedMinor: null, holdPlaced: false });

const plan = (overrides: Partial<PlanViewRaw> = {}): PlanViewRaw => ({
  id: "plan-1", groupId: "group-1", title: "Bangkok weekend", summary: null, status: "reviewing", deadlineAt: new Date("2026-11-02T00:00:00Z"), baseCurrency: "USD",
  fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 3, replacedByPlanId: null,
  trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
  members: [member("maya", "Maya"), member("ana", "Ana"), member("jo", "Jo")],
  picks: [
    { id: "p-hotel", offer: hotel({ freeCancellationUntil: "2026-12-10T12:00:00Z" }), memberIds: ["maya", "ana"], reason: "", notes: {} },
    { id: "p-flight", offer: flight(), memberIds: ["ana", "jo"], reason: "", notes: {} },
  ],
  ideas: [], covers: [], bookings: [],
  ...overrides,
});

describe("planFactsFor", () => {
  it("counts the people in a persona's room, and says they are not on a flight when only others are", () => {
    expect(planFactsFor(plan(), "maya", 9_000, NOW)).toEqual({ shareMinor: 9_000, currency: "USD", rooms: [{ occupants: 2, freeCancellation: true }], onFlight: false });
  });

  it("says when the persona is on a flight", () => {
    expect(planFactsFor(plan(), "ana", null, NOW).onFlight).toBe(true);
  });

  it("does not count free cancellation that has already run out, or was never listed", () => {
    const lapsed = plan({ picks: [{ id: "p", offer: hotel({ freeCancellationUntil: "2026-10-01T00:00:00Z" }), memberIds: ["maya"], reason: "", notes: {} }] });
    expect(planFactsFor(lapsed, "maya", 1, NOW).rooms).toEqual([{ occupants: 1, freeCancellation: false }]);
    const unlisted = plan({ picks: [{ id: "p", offer: { ...hotel(), freeCancellationUntil: undefined }, memberIds: ["maya"], reason: "", notes: {} }] });
    expect(planFactsFor(unlisted, "maya", 1, NOW).rooms[0].freeCancellation).toBe(false);
  });

  it("has no rooms for someone with no hotel pick", () => {
    expect(planFactsFor(plan(), "jo", 1, NOW).rooms).toEqual([]);
  });
});

describe("planBriefFor", () => {
  it("describes the plan with names and amounts as written, and no ids", () => {
    const brief = planBriefFor(plan(), "maya", 9_000, NOW);
    expect(brief).toMatchObject({ title: "Bangkok weekend", yourShare: "$90.00", roomWith: ["Ana"], freeCancellation: true });
    expect(brief.hotel).toContain(hotel().title);
    expect(JSON.stringify(brief)).not.toContain("p-hotel");
  });

  it("leaves the share and total empty when they cannot be given", () => {
    const brief = planBriefFor(plan({ picks: [] }), "maya", null, NOW);
    expect(brief).toMatchObject({ yourShare: null, total: null, hotel: null, roomWith: [], freeCancellation: null });
  });
});
