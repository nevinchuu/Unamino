import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { PlanStatus } from "@/domain/plan/statuses";
import type { PlanViewRaw } from "@/domain/plan/view-store";
import { flight, hotel } from "@/domain/plan/test-support";
import { ViewerCards } from "./viewer-card";

const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PLAN = "11111111-2222-4333-8444-555555555555";

const raw = (status: PlanStatus = "reviewing", agreement: "pending" | "agreed" = "pending", approval: "pending" | "approved" = "pending"): PlanViewRaw => ({
  id: PLAN, groupId: GROUP, title: "Bangkok", summary: null, status, deadlineAt: new Date("2026-10-27T01:09:00Z"), baseCurrency: "USD",
  fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, replacedByPlanId: null, trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
  members: [{ id: "ana", name: "Ana", currency: "USD", planAgreement: agreement, approval, approvedMinor: null, chargedMinor: null, holdPlaced: false }],
  picks: [{ id: "p1", offer: hotel(), memberIds: ["ana"], reason: "r", notes: {} }, { id: "p2", offer: flight(), memberIds: ["ana"], reason: "r", notes: {} }], ideas: [], bookings: [],
});

function setup(plan: PlanViewRaw | "missing" = raw()) {
  let reads = 0;
  let now = new Date("2026-10-27T01:00:00Z").getTime();
  const cards = new ViewerCards({
    views: { load: async () => (reads += 1, plan === "missing" ? err({ code: "not_found", message: "none" }) : ok(plan)) },
    payments: "none",
    clock: () => new Date(now),
  });
  return { cards, reads: () => reads, later: (ms: number) => void (now += ms) };
}

describe("ViewerCards", () => {
  it("offers a person who has not agreed their own price to agree to", async () => {
    const card = await setup().cards.forPlan(PLAN, "ana");
    expect(card).toMatchObject({ canAgree: true, agreed: false, currency: "USD", needsAmount: false });
    expect(card?.shareMinor).toBeGreaterThan(0);
  });

  it("also carries what the sheet shows: where each person stands, the parts of the price, and whether changes can be asked for", async () => {
    const card = await setup().cards.forPlan(PLAN, "ana");
    expect(card?.people).toEqual([{ name: "Ana", isMe: true, agreed: false, approved: false, held: false }]);
    expect(card?.canRequestChanges).toBe(true);
    expect(card?.lines.map((line) => line.minor).reduce((sum, minor) => sum + minor, 0)).toBe(card?.shareMinor);
  });

  it("says a person has agreed once they have, and offers them nothing more to agree to", async () => {
    expect(await setup(raw("reviewing", "agreed")).cards.forPlan(PLAN, "ana")).toMatchObject({ canAgree: false, agreed: true });
  });

  it("points a person whose turn it is to approve their amount at the plan", async () => {
    expect(await setup(raw("approving", "agreed")).cards.forPlan(PLAN, "ana")).toMatchObject({ canAgree: false, needsAmount: true });
  });

  it("offers nothing to someone who is not in the plan, or when the plan cannot be read", async () => {
    expect(await setup().cards.forPlan(PLAN, "newcomer")).toBeNull();
    expect(await setup("missing").cards.forPlan(PLAN, "ana")).toBeNull();
  });

  it("keeps an answer for a few seconds, so the chat's regular question does not read the whole plan each time", async () => {
    const { cards, reads, later } = setup();
    await cards.forPlan(PLAN, "ana");
    await cards.forPlan(PLAN, "ana");
    expect(reads()).toBe(1);

    later(6_000);
    await cards.forPlan(PLAN, "ana");
    expect(reads()).toBe(2);
  });

  it("keeps each person's answer apart", async () => {
    const { cards, reads } = setup();
    await cards.forPlan(PLAN, "ana");
    await cards.forPlan(PLAN, "newcomer");
    expect(reads()).toBe(2);
  });
});
