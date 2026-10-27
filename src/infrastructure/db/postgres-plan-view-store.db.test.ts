import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BANGKOK_OFFERS } from "@/domain/planner/test-support";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresPlanViewStore } from "./postgres-plan-view-store";
import { groups, members, planMembers, planPicks, plans, scheduleSuggestions, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-plan-view-store
 * Everything it creates hangs off one group that is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const T0 = new Date("2026-10-27T00:00:00.000Z");
const DEADLINE = new Date("2026-10-27T00:09:00.000Z");
const FLIGHT = BANGKOK_OFFERS.find((offer) => offer.kind === "flight");
const HOTEL = BANGKOK_OFFERS.find((offer) => offer.kind === "hotel");
if (!FLIGHT || !HOTEL) throw new Error("The fixtures need a flight and a hotel");

describe.skipIf(!ENABLED)("PostgresPlanViewStore on the real database", () => {
  let handle: DatabaseHandle;
  let store: PostgresPlanViewStore;
  let groupId: string;
  let planId: string;
  const memberIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
    store = new PostgresPlanViewStore(handle.db);

    const [group] = await handle.db.insert(groups).values({ name: "db-test-group", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    // One statement each, so they get different creation times and a known order.
    for (const [name, currency] of [["ana", "USD"], ["ben", "SGD"]] as const) {
      const [row] = await handle.db.insert(members).values({ groupId, displayName: name, currency, status: "joined", joinedAt: T0, inviteTokenHash: randomUUID() }).returning({ id: members.id });
      memberIds.push(row.id);
    }
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: 2, destinationCity: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" }).returning({ id: tripBriefs.id });
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId: brief.id, status: "approving", title: "Bangkok weekend", summary: "A shared room", deadlineAt: DEADLINE, hardDeadlineAt: new Date("2026-10-29T00:00:00Z"), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: { SGD: 1.35 } }, headcount: 2, inputsHash: "test" })
      .returning({ id: plans.id });
    planId = plan.id;
    await handle.db.insert(planMembers).values([
      { planId, memberId: memberIds[0], planAgreement: "agreed", approval: "approved", approvedMinor: 30_000, holdPlaced: true },
      { planId, memberId: memberIds[1], planAgreement: "agreed" },
    ]);
    await handle.db.insert(planPicks).values([
      { planId, position: 1, offer: HOTEL!, listingId: HOTEL!.listingId, memberIds, reason: "hotel reason", notes: { [memberIds[1]]: "own room" } },
      { planId, position: 0, offer: FLIGHT!, listingId: FLIGHT!.listingId, memberIds, reason: "flight reason" },
    ]);
    await handle.db.insert(scheduleSuggestions).values([
      { planId, gapId: "g2", date: "2026-12-12", startTime: "14:00", endTime: "16:00", category: "tour", why: "later", venue: { placeId: "p2", name: "Grand Palace", address: null, mapsUrl: null, businessStatus: "operational", hours: null }, checkedAt: T0 },
      { planId, gapId: "g1", date: "2026-12-12", startTime: "10:00", endTime: "12:00", category: "market", why: "earlier", venue: { placeId: "p1", name: "Chatuchak Market", address: "Bangkok", mapsUrl: "https://maps.example/p1", businessStatus: "operational", hours: null }, checkedAt: T0 },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("loads the plan with its trip, its people by name in the order they joined, its picks and its ideas", async () => {
    const loaded = await store.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const raw = loaded.value;

    expect(raw).toMatchObject({ id: planId, groupId, title: "Bangkok weekend", summary: "A shared room", status: "approving", deadlineAt: DEADLINE, baseCurrency: "USD", headcount: 2, replacedByPlanId: null });
    expect(raw.fx.ratesPerBase).toEqual({ SGD: 1.35 });
    expect(raw.trip).toEqual({ city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" });
    expect(raw.members).toEqual([
      { id: memberIds[0], name: "ana", currency: "USD", planAgreement: "agreed", approval: "approved", approvedMinor: 30_000, holdPlaced: true },
      { id: memberIds[1], name: "ben", currency: "SGD", planAgreement: "agreed", approval: "pending", approvedMinor: null, holdPlaced: false },
    ]);
    expect(raw.picks.map((pick) => [pick.offer.id, pick.reason])).toEqual([[FLIGHT!.id, "flight reason"], [HOTEL!.id, "hotel reason"]]);
    expect(raw.picks[1].notes).toEqual({ [memberIds[1]]: "own room" });
    expect(raw.ideas.map((idea) => idea.venue.name)).toEqual(["Chatuchak Market", "Grand Palace"]);
  }, 30_000);

  it("never reads anyone's token or hash", async () => {
    const loaded = await store.load(planId);
    expect(JSON.stringify(loaded)).not.toMatch(/token|hash/i);
  }, 30_000);

  it("reports a plan that does not exist", async () => {
    const result = await store.load(randomUUID());
    expect(result.ok ? null : result.error.code).toBe("not_found");
  }, 30_000);

  it("says which group a plan belongs to, and null for no such plan", async () => {
    expect(await store.groupIdOf(planId)).toEqual({ ok: true, value: groupId });
    expect(await store.groupIdOf(randomUUID())).toEqual({ ok: true, value: null });
  }, 30_000);
});
