import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BANGKOK_OFFERS } from "@/domain/planner/test-support";
import type { PlanStatus } from "@/domain/plan/statuses";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresRetentionStore } from "./postgres-retention-store";
import { bookingRecords, groups, members, messages, planMembers, planPicks, plans, supplierBookings, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-retention-store
 * Everything it creates is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const HARD = new Date("2026-10-29T00:00:00.000Z");
const HOTEL = BANGKOK_OFFERS.find((offer) => offer.kind === "hotel");
if (!HOTEL) throw new Error("The fixtures need a hotel");

describe.skipIf(!ENABLED)("PostgresRetentionStore on the real database", () => {
  let handle: DatabaseHandle;
  let store: PostgresRetentionStore;
  const groupIds: string[] = [];
  const planIds: string[] = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
    store = new PostgresRetentionStore(handle.db);
  });

  afterAll(async () => {
    if (!handle) return;
    if (planIds.length > 0) await handle.db.delete(bookingRecords).where(inArray(bookingRecords.planId, planIds));
    for (const groupId of groupIds) {
      await handle.db.delete(plans).where(eq(plans.groupId, groupId));
      await handle.db.delete(groups).where(eq(groups.id, groupId));
    }
    await handle.close();
  }, 60_000);

  /** A group with one person and one plan in `status`, for a trip with the given dates. */
  async function groupWithPlan(status: PlanStatus, trip: { departDate: string | null; returnDate: string | null } = { departDate: "2026-12-15", returnDate: "2026-12-18" }) {
    const [group] = await handle.db.insert(groups).values({ name: "db-test-retention", baseCurrency: "USD" }).returning({ id: groups.id });
    groupIds.push(group.id);
    const [member] = await handle.db.insert(members).values({ groupId: group.id, displayName: "Ana", currency: "USD", status: "joined", joinedAt: new Date(), inviteTokenHash: randomUUID() }).returning({ id: members.id });
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId: group.id, version: 1, headcount: 1, destinationCity: "Bangkok", ...trip }).returning({ id: tripBriefs.id });
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId: group.id, briefId: brief.id, status, title: "Test trip", deadlineAt: HARD, hardDeadlineAt: HARD, baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, inputsHash: "test" })
      .returning({ id: plans.id });
    planIds.push(plan.id);
    await handle.db.insert(planMembers).values({ planId: plan.id, memberId: member.id, planAgreement: "agreed", approval: "approved", approvedMinor: 10_000, chargedMinor: 9_000, holdId: "pi_test_retention" });
    const [pick] = await handle.db.insert(planPicks).values({ planId: plan.id, position: 0, offer: HOTEL!, listingId: HOTEL!.listingId, memberIds: [member.id], reason: "hotel" }).returning({ id: planPicks.id });
    await handle.db.insert(supplierBookings).values({ planId: plan.id, pickId: pick.id, kind: "hotel", bookingId: "hb-retention", confirmation: "HC-RET", status: "booked" });
    return { groupId: group.id, planId: plan.id, memberId: member.id };
  }

  const ids = async (now: string): Promise<readonly string[]> => {
    const found = await store.expiredGroupIds(new Date(now), 500);
    if (!found.ok) throw new Error(found.error.message);
    return found.value;
  };

  it("finds a booked trip once it ended more than 30 days ago, and not before", async () => {
    const { groupId } = await groupWithPlan("captured");
    expect(await ids("2027-01-10T03:00:00Z")).not.toContain(groupId);
    expect(await ids("2027-01-17T03:00:00Z")).not.toContain(groupId);
    expect(await ids("2027-01-18T03:00:00Z")).toContain(groupId);
  }, 30_000);

  it("counts a trip with no return date from its departure, and one with no dates from the day the plan was made", async () => {
    const oneWay = await groupWithPlan("captured", { departDate: "2026-12-15", returnDate: null });
    const undated = await groupWithPlan("captured", { departDate: null, returnDate: null });
    expect(await ids("2027-01-13T03:00:00Z")).not.toContain(oneWay.groupId);
    expect(await ids("2027-01-15T03:00:00Z")).toContain(oneWay.groupId);
    // The undated plan was made today, so it is counted from today.
    expect(await ids(new Date(Date.now() + 29 * 86_400_000).toISOString())).not.toContain(undated.groupId);
    expect(await ids(new Date(Date.now() + 32 * 86_400_000).toISOString())).toContain(undated.groupId);
  }, 30_000);

  it("never touches a group with a plan still being decided, however old", async () => {
    for (const status of ["reviewing", "approving", "held", "booking"] as const) {
      const { groupId } = await groupWithPlan(status);
      expect(await ids("2100-01-01T03:00:00Z")).not.toContain(groupId);
    }
  }, 60_000);

  it("finds a group that never booked once it has been quiet for 30 days", async () => {
    const { groupId } = await groupWithPlan("expired");
    await handle.db.insert(messages).values({ groupId, kind: "system", body: "hello" });
    expect(await ids(new Date().toISOString())).not.toContain(groupId);
    expect(await ids(new Date(Date.now() + 29 * 86_400_000).toISOString())).not.toContain(groupId);
    expect(await ids(new Date(Date.now() + 31 * 86_400_000).toISOString())).toContain(groupId);
  }, 30_000);

  it("keeps a dispute record without chat or contact details, then deletes the group and everything in it", async () => {
    const { groupId, planId, memberId } = await groupWithPlan("captured");
    await handle.db.insert(messages).values({ groupId, memberId, kind: "human", body: "private chat that must not be kept" });

    expect((await store.archiveAndDelete(groupId)).ok).toBe(true);

    expect(await handle.db.select().from(groups).where(eq(groups.id, groupId))).toEqual([]);
    expect(await handle.db.select().from(members).where(eq(members.groupId, groupId))).toEqual([]);
    expect(await handle.db.select().from(messages).where(eq(messages.groupId, groupId))).toEqual([]);
    expect(await handle.db.select().from(plans).where(eq(plans.groupId, groupId))).toEqual([]);

    const [record] = await handle.db.select().from(bookingRecords).where(eq(bookingRecords.planId, planId));
    expect(record).toMatchObject({
      reference: expect.stringMatching(/^UN-[0-9A-F]{6}$/),
      planTitle: "Test trip",
      city: "Bangkok",
      departDate: "2026-12-15",
      returnDate: "2026-12-18",
      purgeAfter: "2028-06-10",
      payments: [{ payerName: "Ana", paymentId: "pi_test_retention", approvedMinor: 10_000, chargedMinor: 9_000, currency: "USD" }],
      suppliers: [{ kind: "hotel", bookingId: "hb-retention", confirmation: "HC-RET" }],
    });
    expect(JSON.stringify(record)).not.toContain("private chat");
  }, 60_000);

  it("keeps no record for a group that never booked", async () => {
    const { groupId, planId } = await groupWithPlan("expired");
    expect((await store.archiveAndDelete(groupId)).ok).toBe(true);
    expect(await handle.db.select().from(bookingRecords).where(eq(bookingRecords.planId, planId))).toEqual([]);
  }, 30_000);

  it("deletes a dispute record once its day has passed, and not before", async () => {
    const { groupId, planId } = await groupWithPlan("captured");
    await store.archiveAndDelete(groupId);
    const before = await store.purgeRecords(new Date("2028-06-10T03:00:00Z"));
    expect(before.ok && (await handle.db.select().from(bookingRecords).where(eq(bookingRecords.planId, planId))).length).toBe(1);
    const after = await store.purgeRecords(new Date("2028-06-11T03:00:00Z"));
    expect(after.ok && after.value).toBeGreaterThanOrEqual(1);
    expect(await handle.db.select().from(bookingRecords).where(eq(bookingRecords.planId, planId))).toEqual([]);
  }, 30_000);
});
