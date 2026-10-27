import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HotelQuery } from "@/domain/offers/offer-source";
import { BANGKOK_OFFERS } from "@/domain/planner/test-support";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresPlanDetailsStore } from "./postgres-plan-details-store";
import { groups, members, offerSearches, planMembers, planPicks, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-plan-details-store
 * Everything it creates hangs off one group that is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const T0 = new Date("2026-10-27T00:00:00.000Z");
const HARD = new Date("2026-10-29T00:00:00.000Z");
const HOTEL_QUERY: HotelQuery = { kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-11", checkOut: "2026-12-13", guests: 2 };
const HOTEL = BANGKOK_OFFERS.find((offer) => offer.kind === "hotel");
const FLIGHT = BANGKOK_OFFERS.find((offer) => offer.kind === "flight");
if (!HOTEL || !FLIGHT) throw new Error("The fixtures need a hotel and a flight");

describe.skipIf(!ENABLED)("PostgresPlanDetailsStore on the real database", () => {
  let handle: DatabaseHandle;
  let store: PostgresPlanDetailsStore;
  let groupId: string;
  let briefId: string;
  let searchId: string;
  const memberIds: string[] = [];

  async function seedPlan(input: { status?: "reviewing" | "expired" | "booking"; deadlineAt?: Date; offersCheckedAt?: Date | null } = {}): Promise<string> {
    const [plan] = await handle.db
      .insert(plans)
      .values({
        groupId,
        briefId,
        status: input.status ?? "reviewing",
        title: "Test trip",
        deadlineAt: input.deadlineAt ?? new Date("2026-10-27T00:09:00.000Z"),
        hardDeadlineAt: HARD,
        baseCurrency: "USD",
        fx: { baseCurrency: "USD", source: "test", ratesPerBase: { SGD: 1.35 } },
        headcount: memberIds.length,
        inputsHash: "test",
        offersCheckedAt: input.offersCheckedAt ?? null,
      })
      .returning({ id: plans.id });
    await handle.db.insert(planMembers).values(memberIds.map((memberId) => ({ planId: plan.id, memberId })));
    return plan.id;
  }

  async function seedPicks(planId: string): Promise<string[]> {
    const rows = await handle.db
      .insert(planPicks)
      .values([
        { planId, position: 1, offer: FLIGHT!, listingId: FLIGHT!.listingId, searchId: null, memberIds, reason: "flight" },
        { planId, position: 0, offer: HOTEL!, listingId: HOTEL!.listingId, searchId, memberIds, reason: "hotel" },
      ])
      .returning({ id: planPicks.id, position: planPicks.position });
    return rows.sort((a, b) => a.position - b.position).map((row) => row.id);
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 8);
    store = new PostgresPlanDetailsStore(handle.db);

    const [group] = await handle.db.insert(groups).values({ name: "db-test-group", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    // One statement each, so they get different creation times and a known order.
    for (const [name, currency] of [["ana", "USD"], ["ben", "SGD"]] as const) {
      const [row] = await handle.db
        .insert(members)
        .values({ groupId, displayName: name, currency, status: "joined", joinedAt: T0, inviteTokenHash: randomUUID() })
        .returning({ id: members.id });
      memberIds.push(row.id);
    }
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: memberIds.length }).returning({ id: tripBriefs.id });
    briefId = brief.id;
    const [search] = await handle.db.insert(offerSearches).values({ briefId, kind: "hotel", query: HOTEL_QUERY, guests: 2 }).returning({ id: offerSearches.id });
    searchId = search.id;
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    // plans reference briefs, so the plans go first; everything else follows the group.
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("loads the picks in plan order, the members with their currencies, and only the queries the picks use", async () => {
    const planId = await seedPlan();
    const [hotelPickId, flightPickId] = await seedPicks(planId);

    const loaded = await store.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const details = loaded.value;

    expect(details.baseCurrency).toBe("USD");
    expect(details.fx.ratesPerBase).toEqual({ SGD: 1.35 });
    expect(details.offersCheckedAt).toBeNull();
    expect(details.members).toEqual([{ id: memberIds[0], currency: "USD" }, { id: memberIds[1], currency: "SGD" }]);
    expect(details.picks.map((pick) => pick.id)).toEqual([hotelPickId, flightPickId]);
    expect(details.picks[0]).toMatchObject({ searchId, memberIds, offer: HOTEL });
    expect(details.picks[1].searchId).toBeNull();
    expect([...details.queries.keys()]).toEqual([searchId]);
    expect(details.queries.get(searchId)).toEqual(HOTEL_QUERY);
  }, 30_000);

  it("reports a plan that does not exist", async () => {
    const result = await store.load(randomUUID());
    expect(result.ok ? null : result.error.code).toBe("not_found");
  });

  it("lets one caller start a check, refuses the next during the cooldown, and allows it again after", async () => {
    const planId = await seedPlan();
    const now = new Date("2026-10-27T00:05:00.000Z");

    expect(await store.claimRefresh(planId, now, 10_000)).toEqual({ ok: true, value: true });
    expect(await store.claimRefresh(planId, new Date(now.getTime() + 9_000), 10_000)).toEqual({ ok: true, value: false });
    expect(await store.claimRefresh(planId, new Date(now.getTime() + 10_000), 10_000)).toEqual({ ok: true, value: true });

    const loaded = await store.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.value.offersCheckedAt).toEqual(new Date(now.getTime() + 10_000));
  }, 30_000);

  it("gives exactly one of several simultaneous callers the check", async () => {
    const planId = await seedPlan();
    const now = new Date("2026-10-27T00:05:00.000Z");
    const results = await Promise.all(Array.from({ length: 6 }, () => store.claimRefresh(planId, now, 10_000)));
    expect(results.filter((result) => result.ok && result.value)).toHaveLength(1);
    expect(results.every((result) => result.ok)).toBe(true);
  }, 30_000);

  it("reports a check claimed on a plan that does not exist", async () => {
    const result = await store.claimRefresh(randomUUID(), T0, 10_000);
    expect(result.ok ? null : result.error.code).toBe("not_found");
  });

  it("replaces the stored offers of the renewed picks and leaves the others alone", async () => {
    const planId = await seedPlan();
    const [hotelPickId] = await seedPicks(planId);
    const renewedHotel = { ...HOTEL!, id: "renewed-offer-id", expiresAt: "2026-10-27T01:19:00.000Z" };

    expect(await store.saveRenewal(planId, [{ pickId: hotelPickId, offer: renewedHotel }])).toEqual({ ok: true, value: undefined });

    const loaded = await store.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.value.picks[0].offer).toEqual(renewedHotel);
    expect(loaded.value.picks[0].offer.listingId).toBe(HOTEL!.listingId);
    expect(loaded.value.picks[1].offer).toEqual(FLIGHT);
  }, 30_000);

  it("refuses a renewal for a pick of another plan and saves nothing from that batch", async () => {
    const planId = await seedPlan();
    const [hotelPickId] = await seedPicks(planId);
    const otherPlanId = await seedPlan();
    const [otherHotelPickId] = await seedPicks(otherPlanId);
    const renewed = { ...HOTEL!, id: "should-not-be-saved" };

    const result = await store.saveRenewal(planId, [{ pickId: hotelPickId, offer: renewed }, { pickId: otherHotelPickId, offer: renewed }]);
    expect(result.ok ? null : result.error.code).toBe("not_found");

    for (const id of [planId, otherPlanId]) {
      const loaded = await store.load(id);
      if (!loaded.ok) throw new Error(loaded.error.message);
      expect(loaded.value.picks[0].offer.id).toBe(HOTEL!.id);
    }
  }, 30_000);

  it("lists plans past their deadline that can still expire, oldest first, and skips the rest", async () => {
    const now = new Date("2026-10-27T12:00:00.000Z");
    const older = await seedPlan({ deadlineAt: new Date("2026-10-27T10:00:00.000Z") });
    const newer = await seedPlan({ deadlineAt: new Date("2026-10-27T11:00:00.000Z") });
    const future = await seedPlan({ deadlineAt: new Date("2026-10-27T13:00:00.000Z") });
    const alreadyExpired = await seedPlan({ status: "expired", deadlineAt: new Date("2026-10-27T09:00:00.000Z") });
    const booking = await seedPlan({ status: "booking", deadlineAt: new Date("2026-10-27T09:30:00.000Z") });

    const result = await store.listPastDeadline(now, 1_000);
    if (!result.ok) throw new Error(result.error.message);
    const ours = result.value.filter((id) => [older, newer, future, alreadyExpired, booking].includes(id));
    expect(ours).toEqual([older, newer]);
  }, 30_000);
});
