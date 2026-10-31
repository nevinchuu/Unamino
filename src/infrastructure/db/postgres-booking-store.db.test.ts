import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BANGKOK_OFFERS } from "@/domain/planner/test-support";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresBookingStore } from "./postgres-booking-store";
import { groups, members, planMembers, planPicks, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-booking-store
 * Everything it creates hangs off one group that is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const HARD = new Date("2026-10-29T00:00:00.000Z");
const HOTEL = BANGKOK_OFFERS.find((offer) => offer.kind === "hotel");
const FLIGHT = BANGKOK_OFFERS.find((offer) => offer.kind === "flight");
if (!HOTEL || !FLIGHT) throw new Error("The fixtures need a hotel and a flight");

describe.skipIf(!ENABLED)("PostgresBookingStore on the real database", () => {
  let handle: DatabaseHandle;
  let store: PostgresBookingStore;
  let groupId: string;
  let planId: string;
  let hotelPickId: string;
  let flightPickId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
    store = new PostgresBookingStore(handle.db);

    const [group] = await handle.db.insert(groups).values({ name: "db-test-group", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    const [member] = await handle.db.insert(members).values({ groupId, displayName: "ana", currency: "USD", status: "joined", joinedAt: new Date(), inviteTokenHash: randomUUID() }).returning({ id: members.id });
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: 1 }).returning({ id: tripBriefs.id });
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId: brief.id, status: "booking", title: "Test trip", deadlineAt: HARD, hardDeadlineAt: HARD, baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, inputsHash: "test" })
      .returning({ id: plans.id });
    planId = plan.id;
    await handle.db.insert(planMembers).values({ planId, memberId: member.id });
    const picks = await handle.db
      .insert(planPicks)
      .values([
        { planId, position: 0, offer: HOTEL!, listingId: HOTEL!.listingId, memberIds: [member.id], reason: "hotel" },
        { planId, position: 1, offer: FLIGHT!, listingId: FLIGHT!.listingId, memberIds: [member.id], reason: "flight" },
      ])
      .returning({ id: planPicks.id, position: planPicks.position });
    hotelPickId = picks.find((pick) => pick.position === 0)?.id ?? "";
    flightPickId = picks.find((pick) => pick.position === 1)?.id ?? "";
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("keeps the bookings of a plan and lists them in the order they were made", async () => {
    expect(await store.record({ planId, pickId: hotelPickId, kind: "hotel", bookingId: "hb-1", confirmation: "HC1", status: "booked" })).toEqual({ ok: true, value: undefined });
    expect(await store.record({ planId, pickId: flightPickId, kind: "flight", bookingId: "fb-1", confirmation: null, status: "booked" })).toEqual({ ok: true, value: undefined });

    const listed = await store.list(planId);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.map((booking) => [booking.kind, booking.bookingId, booking.confirmation, booking.status])).toEqual([
      ["hotel", "hb-1", "HC1", "booked"],
      ["flight", "fb-1", null, "booked"],
    ]);
  }, 30_000);

  it("keeps the first booking when the same pick is saved again", async () => {
    await store.record({ planId, pickId: hotelPickId, kind: "hotel", bookingId: "hb-other", confirmation: null, status: "booked" });

    const listed = await store.list(planId);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.find((booking) => booking.pickId === hotelPickId)?.bookingId).toBe("hb-1");
  }, 30_000);

  it("moves a booking to cancelling and then cancelled", async () => {
    await store.setStatus(planId, flightPickId, "cancelling");
    let listed = await store.list(planId);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.find((booking) => booking.pickId === flightPickId)?.status).toBe("cancelling");

    await store.setStatus(planId, flightPickId, "cancelled");
    listed = await store.list(planId);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.find((booking) => booking.pickId === flightPickId)?.status).toBe("cancelled");
  }, 30_000);

  it("finds a plan that has been booking since before a time, and only that plan", async () => {
    await handle.db.update(plans).set({ status: "booking", updatedAt: new Date("2026-10-27T00:00:00.000Z") }).where(eq(plans.id, planId));
    const later = new Date("2026-10-27T00:10:00.000Z");

    const stuck = await store.stuckPlans(later, 10);
    expect(stuck.ok && stuck.value).toContain(planId);
    expect(await store.isStuck(planId, later)).toEqual({ ok: true, value: true });

    expect(await store.isStuck(planId, new Date("2026-10-26T00:00:00.000Z"))).toEqual({ ok: true, value: false });
    const none = await store.stuckPlans(new Date("2026-10-26T00:00:00.000Z"), 10);
    expect(none.ok && none.value).not.toContain(planId);
  }, 30_000);

  it("finds a plan that has been fully approved for a while without booking, and not one that is booking or new", async () => {
    await handle.db.update(plans).set({ status: "held", updatedAt: new Date("2026-10-27T00:00:00.000Z") }).where(eq(plans.id, planId));
    const later = new Date("2026-10-27T00:02:00.000Z");

    const stalled = await store.stalledPlans(later, 10);
    expect(stalled.ok && stalled.value).toContain(planId);
    expect(await store.isStalled(planId, later)).toEqual({ ok: true, value: true });

    expect(await store.isStalled(planId, new Date("2026-10-26T00:00:00.000Z"))).toEqual({ ok: true, value: false });
    await handle.db.update(plans).set({ status: "booking" }).where(eq(plans.id, planId));
    expect(await store.isStalled(planId, later)).toEqual({ ok: true, value: false });
    const none = await store.stalledPlans(later, 10);
    expect(none.ok && none.value).not.toContain(planId);
  }, 30_000);

  it("finds an ended plan that still has a booking to cancel, and stops once all are cancelled", async () => {
    await handle.db.update(plans).set({ status: "booked" }).where(eq(plans.id, planId));
    const whileBooked = await store.unsettledPlans(50);
    expect(whileBooked.ok && whileBooked.value).not.toContain(planId);

    await handle.db.update(plans).set({ status: "expired" }).where(eq(plans.id, planId));
    await store.setStatus(planId, hotelPickId, "cancelling");
    await store.setStatus(planId, flightPickId, "booked");
    const open = await store.unsettledPlans(50);
    expect(open.ok && open.value).toContain(planId);

    await store.setStatus(planId, hotelPickId, "cancelled");
    await store.setStatus(planId, flightPickId, "cancelled");
    const done = await store.unsettledPlans(50);
    expect(done.ok && done.value).not.toContain(planId);
  }, 30_000);
});
