import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ok } from "@/lib/result";
import type { HotelQuery } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import { PlanService } from "@/domain/plan/service";
import { hotel, ScriptedSource } from "@/domain/plan/test-support";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresEffectRecorder } from "./postgres-effect-recorder";
import { PostgresPlanDetailsStore } from "./postgres-plan-details-store";
import { PostgresPlanRepository } from "./postgres-plan-repository";
import { effectLog, groups, members, offerSearches, planMembers, planPicks, plans, tripBriefs } from "./schema";

/**
 * The plan service on the real database, with a scripted offer source so nothing outside the database is called:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run plan-service.db
 * Everything it creates hangs off one group that is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const T0 = new Date();
const minutesAfter = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const HOTEL_QUERY: HotelQuery = { kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-11", checkOut: "2026-12-13", guests: 2 };

describe.skipIf(!ENABLED)("PlanService on the real database", () => {
  let handle: DatabaseHandle;
  let groupId: string;
  let briefId: string;
  let searchId: string;
  const memberIds: string[] = [];
  /** What the hotel search returns now. */
  let hotelNow: Offer[] = [];

  const serviceFor = (): PlanService => {
    const source = new ScriptedSource(() => ok(hotelNow));
    return new PlanService({
      plans: new PostgresPlanRepository(handle.db),
      details: new PostgresPlanDetailsStore(handle.db),
      source,
      effects: new PostgresEffectRecorder(handle.db),
      search: { retryDelayMs: 0 },
    });
  };

  /** A reviewing plan with one hotel pick for both members, priced 200.00 each, with its deadline soon. */
  async function seedPlan(deadlineAt: Date = minutesAfter(2)): Promise<string> {
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId, status: "reviewing", title: "Test trip", deadlineAt, hardDeadlineAt: minutesAfter(48 * 60), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 2, inputsHash: "test" })
      .returning({ id: plans.id });
    await handle.db.insert(planMembers).values(memberIds.map((memberId) => ({ planId: plan.id, memberId })));
    const original = hotel({ totalMinor: 40_000, expiresAt: deadlineAt.toISOString() });
    await handle.db.insert(planPicks).values({ planId: plan.id, position: 0, offer: original, listingId: original.listingId, searchId, memberIds, reason: "hotel" });
    return plan.id;
  }

  const effectTypes = async (planId: string): Promise<string[]> =>
    (await handle.db.select({ type: effectLog.type }).from(effectLog).where(eq(effectLog.planId, planId)).orderBy(asc(effectLog.effectKey))).map((row) => row.type);

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 8);
    const [group] = await handle.db.insert(groups).values({ name: "db-test-group", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    for (const name of ["ana", "ben"]) {
      const [row] = await handle.db.insert(members).values({ groupId, displayName: name, currency: "USD", status: "joined", joinedAt: T0, inviteTokenHash: randomUUID() }).returning({ id: members.id });
      memberIds.push(row.id);
    }
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: 2 }).returning({ id: tripBriefs.id });
    briefId = brief.id;
    const [search] = await handle.db.insert(offerSearches).values({ briefId, kind: "hotel", query: HOTEL_QUERY, guests: 2 }).returning({ id: offerSearches.id });
    searchId = search.id;
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("takes both members through step 1 and step 2, renewing the offers on the way", async () => {
    hotelNow = [hotel({ id: "renewed", totalMinor: 40_000, expiresAt: minutesAfter(9).toISOString() })];
    const planId = await seedPlan();
    const service = serviceFor();
    const [ana, ben] = memberIds;

    expect((await service.agree(planId, ana, 20_000, T0)).ok).toBe(true);
    const lastAgreement = await service.agree(planId, ben, 20_000, minutesAfter(1));
    expect(lastAgreement.ok && lastAgreement.value).toMatchObject({ status: "done", plan: { status: "approving" } });

    const approved = await service.approveAmount(planId, ana, 20_000, minutesAfter(1));
    expect(approved.ok && approved.value).toMatchObject({ status: "done" });

    const stored = await new PostgresPlanRepository(handle.db).load(planId);
    if (!stored.ok) throw new Error(stored.error.message);
    expect(stored.value.plan.deadlineAt).toEqual(minutesAfter(9));
    expect(stored.value.plan.members.map((m) => [m.planAgreement, m.approval, m.approvedMinor])).toEqual([["agreed", "approved", 20_000], ["agreed", "pending", null]]);

    const picks = await handle.db.select().from(planPicks).where(eq(planPicks.planId, planId));
    expect(picks[0].offer.id).toBe("renewed");
    expect(await effectTypes(planId)).toEqual(["request_approval", "place_hold"]);
  }, 60_000);

  it("ends the plan and records the release when a member declines their amount", async () => {
    hotelNow = [hotel({ id: "renewed", totalMinor: 40_000, expiresAt: minutesAfter(9).toISOString() })];
    const planId = await seedPlan();
    const service = serviceFor();
    const [ana, ben] = memberIds;
    await service.agree(planId, ana, 20_000, T0);
    await service.agree(planId, ben, 20_000, minutesAfter(1));
    const declined = await service.declineAmount(planId, ben, minutesAfter(1));
    expect(declined.ok && declined.value).toMatchObject({ status: "done", plan: { status: "expired" } });
  }, 60_000);

  it("ends a plan whose hotel is gone, and leaves its picks as they were", async () => {
    hotelNow = [hotel({ id: "other", listingId: "another-room", expiresAt: minutesAfter(9).toISOString() })];
    const planId = await seedPlan();
    const result = await serviceFor().agree(planId, memberIds[0], 20_000, T0);
    expect(result.ok && result.value).toMatchObject({ status: "plan_ended", reason: "listing_unavailable" });
    const picks = await handle.db.select().from(planPicks).where(eq(planPicks.planId, planId));
    expect(picks[0].offer.id).toBe("hotel-offer-1");
  }, 60_000);

  it("renews overdue plans and ends the ones past their cap, in one pass", async () => {
    hotelNow = [hotel({ id: "renewed", totalMinor: 40_000, expiresAt: minutesAfter(9).toISOString() })];
    const lapsed = await seedPlan(minutesAfter(-1));
    const pastCap = await seedPlan(minutesAfter(-2));
    await handle.db.update(plans).set({ hardDeadlineAt: minutesAfter(-1) }).where(eq(plans.id, pastCap));

    const summary = await serviceFor().expireOverdue(T0, 1_000);
    if (!summary.ok) throw new Error(JSON.stringify(summary.error));
    // Other plans in the shared database may be overdue too, so only ours are checked.
    expect(summary.value.checked).toBeGreaterThanOrEqual(2);

    const repository = new PostgresPlanRepository(handle.db);
    const lapsedAfter = await repository.load(lapsed);
    const pastCapAfter = await repository.load(pastCap);
    if (!lapsedAfter.ok || !pastCapAfter.ok) throw new Error("plans should still load");
    expect(lapsedAfter.value.plan.status).toBe("reviewing");
    expect(lapsedAfter.value.plan.deadlineAt).toEqual(minutesAfter(9));
    expect(pastCapAfter.value.plan.status).toBe("expired");
  }, 60_000);
});
