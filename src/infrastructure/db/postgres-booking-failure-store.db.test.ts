import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BookingFailureRecord } from "@/domain/booking/failure";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresBookingFailureStore } from "./postgres-booking-failure-store";
import { bookingFailures, groups, members, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-booking-failure-store
 * Everything it creates hangs off throwaway groups that are deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const HARD = new Date("2026-10-29T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60_000;

describe.skipIf(!ENABLED)("PostgresBookingFailureStore on the real database", () => {
  let handle: DatabaseHandle;
  let store: PostgresBookingFailureStore;
  const groupIds: string[] = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
    store = new PostgresBookingFailureStore(handle.db);
  });

  afterAll(async () => {
    if (!handle) return;
    for (const groupId of groupIds) {
      await handle.db.delete(plans).where(eq(plans.groupId, groupId));
      await handle.db.delete(groups).where(eq(groups.id, groupId));
    }
    await handle.close();
  }, 60_000);

  async function newGroup() {
    const [group] = await handle.db.insert(groups).values({ name: "db-test-failures", baseCurrency: "USD" }).returning({ id: groups.id });
    groupIds.push(group.id);
    await handle.db.insert(members).values({ groupId: group.id, displayName: "Ana", currency: "USD", status: "joined", joinedAt: new Date(), inviteTokenHash: randomUUID() });
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId: group.id, version: 1, headcount: 1 }).returning({ id: tripBriefs.id });
    return { groupId: group.id, briefId: brief.id };
  }

  async function newPlan(groupId: string, briefId: string, createdAt: Date) {
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId, status: "expired", title: "Test trip", deadlineAt: HARD, hardDeadlineAt: HARD, baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, inputsHash: randomUUID(), createdAt })
      .returning({ id: plans.id });
    return plan.id;
  }

  const record = (planId: string, overrides: Partial<BookingFailureRecord> = {}): BookingFailureRecord => ({
    planId,
    reason: "price",
    part: { pickId: randomUUID(), kind: "hotel", title: "Riverside Hotel", listingId: `listing-${planId}`, offeredMinor: 12_489, currency: "USD" },
    undone: [{ kind: "flight", title: "SIN to BKK" }],
    retryable: false,
    ...overrides,
  });

  it("keeps a failure, and tells Trippy about the group's newest plan only", async () => {
    const { groupId, briefId } = await newGroup();
    const first = await newPlan(groupId, briefId, new Date(Date.now() - 2 * DAY_MS));
    expect((await store.save(record(first))).ok).toBe(true);

    expect(await store.latest(groupId)).toEqual({ reason: "price", part: { kind: "hotel", title: "Riverside Hotel" }, undone: [{ kind: "flight", title: "SIN to BKK" }], retryable: false });

    // Once the group has made a newer plan, the old failure is no longer what Trippy is told.
    await newPlan(groupId, briefId, new Date());
    expect(await store.latest(groupId)).toBeNull();
  }, 60_000);

  it("keeps a failure with no single part to blame", async () => {
    const { groupId, briefId } = await newGroup();
    const planId = await newPlan(groupId, briefId, new Date());
    await store.save({ planId, reason: "details", part: null, undone: [], retryable: false });
    expect(await store.latest(groupId)).toEqual({ reason: "details", part: null, undone: [], retryable: false });
  }, 30_000);

  it("keeps the first reason when a plan is said to have failed twice", async () => {
    const { groupId, briefId } = await newGroup();
    const planId = await newPlan(groupId, briefId, new Date());
    await store.save(record(planId, { reason: "unavailable" }));
    await store.save(record(planId, { reason: "other" }));
    const rows = await handle.db.select().from(bookingFailures).where(eq(bookingFailures.planId, planId));
    expect(rows.map((row) => row.reason)).toEqual(["unavailable"]);
  }, 30_000);

  it("blocks a listing that could not be booked for a day, for that group only", async () => {
    const one = await newGroup();
    const other = await newGroup();
    const planId = await newPlan(one.groupId, one.briefId, new Date());
    const failed = record(planId);
    await store.save(failed);
    const listingId = failed.part?.listingId ?? "";

    expect([...(await store.blockedListingIds(one.groupId, new Date(Date.now() - DAY_MS)))]).toEqual([listingId]);
    expect([...(await store.blockedListingIds(other.groupId, new Date(Date.now() - DAY_MS)))]).toEqual([]);
    expect([...(await store.blockedListingIds(one.groupId, new Date(Date.now() + 60_000)))]).toEqual([]);
  }, 60_000);

  it("does not block a listing whose supplier was merely unreachable, nor a failure with no listing", async () => {
    const { groupId, briefId } = await newGroup();
    const unreachable = await newPlan(groupId, briefId, new Date(Date.now() - 3000));
    await store.save(record(unreachable, { reason: "temporary", retryable: true }));
    const noPart = await newPlan(groupId, briefId, new Date(Date.now() - 2000));
    await store.save({ planId: noPart, reason: "hold", part: null, undone: [], retryable: false });
    expect([...(await store.blockedListingIds(groupId, new Date(Date.now() - DAY_MS)))]).toEqual([]);
  }, 60_000);

  it("goes when its plan goes", async () => {
    const { groupId, briefId } = await newGroup();
    const planId = await newPlan(groupId, briefId, new Date());
    await store.save(record(planId));
    await handle.db.delete(plans).where(eq(plans.id, planId));
    expect(await handle.db.select().from(bookingFailures).where(eq(bookingFailures.planId, planId))).toEqual([]);
  }, 30_000);
});
