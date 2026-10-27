import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresHoldStore } from "./postgres-hold-store";
import { groups, members, planMembers, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-hold-store
 * Everything it creates hangs off one group that is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const T0 = new Date("2026-10-27T00:00:00.000Z");

describe.skipIf(!ENABLED)("PostgresHoldStore on the real database", () => {
  let handle: DatabaseHandle;
  let store: PostgresHoldStore;
  let groupId: string;
  let briefId: string;
  let memberId: string;

  /** A plan in step 2 where the member has approved 290.09 and has no hold yet. */
  async function seedPlan(overrides: { status?: "approving" | "reviewing"; approval?: "approved" | "pending"; holdPlaced?: boolean } = {}): Promise<string> {
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId, status: overrides.status ?? "approving", title: "Test", deadlineAt: new Date("2026-10-27T00:09:00Z"), hardDeadlineAt: new Date("2026-10-29T00:00:00Z"), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, inputsHash: "test" })
      .returning({ id: plans.id });
    await handle.db.insert(planMembers).values({ planId: plan.id, memberId, planAgreement: "agreed", approval: overrides.approval ?? "approved", approvedMinor: 29_009, holdPlaced: overrides.holdPlaced ?? false });
    return plan.id;
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 8);
    store = new PostgresHoldStore(handle.db);
    const [group] = await handle.db.insert(groups).values({ name: "db-test-group", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    const [member] = await handle.db.insert(members).values({ groupId, displayName: "ana", currency: "USD", status: "joined", joinedAt: T0, inviteTokenHash: randomUUID() }).returning({ id: members.id });
    memberId = member.id;
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: 1 }).returning({ id: tripBriefs.id });
    briefId = brief.id;
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("reads where a member stands: the plan's state, their approval and cap, their currency and any hold", async () => {
    const planId = await seedPlan();
    expect(await store.find(planId, memberId)).toEqual({
      ok: true,
      value: { planId, memberId, currency: "USD", planStatus: "approving", approval: "approved", approvedMinor: 29_009, holdPlaced: false, holdId: null, holdAttempt: 0 },
    });
  }, 30_000);

  it("reports a member who is not in the plan, and a plan that does not exist", async () => {
    const planId = await seedPlan();
    for (const result of [await store.find(planId, randomUUID()), await store.find(randomUUID(), memberId)]) expect(result.ok ? null : result.error.code).toBe("not_found");
  }, 30_000);

  it("remembers a hold for the current attempt and finds its owner from the hold's id", async () => {
    const planId = await seedPlan();
    expect(await store.saveHoldId(planId, memberId, 0, "pi_first")).toEqual({ ok: true, value: "pi_first" });
    expect(await store.find(planId, memberId)).toMatchObject({ ok: true, value: { holdId: "pi_first", holdAttempt: 0 } });
    expect(await store.findByHoldId("pi_first")).toEqual({ ok: true, value: { planId, memberId } });
  }, 30_000);

  it("keeps the first hold when two calls save at the same moment, and tells both which one it is", async () => {
    const planId = await seedPlan();
    const results = await Promise.all(["pi_a", "pi_b", "pi_c"].map((id) => store.saveHoldId(planId, memberId, 0, id)));
    const saved = results.map((r) => (r.ok ? r.value : "error"));
    expect(new Set(saved).size).toBe(1);
    expect(["pi_a", "pi_b", "pi_c"]).toContain(saved[0]);
    const found = await store.find(planId, memberId);
    expect(found.ok && found.value.holdId).toBe(saved[0]);
  }, 30_000);

  it("forgets a hold that was let go of and moves on, so the next approval makes a new one", async () => {
    const planId = await seedPlan();
    await store.saveHoldId(planId, memberId, 0, "pi_old");
    expect(await store.clearHold(planId, memberId, "pi_old")).toEqual({ ok: true, value: undefined });
    expect(await store.find(planId, memberId)).toMatchObject({ ok: true, value: { holdId: null, holdAttempt: 1 } });
    expect((await store.findByHoldId("pi_old")).ok).toBe(false);
  }, 30_000);

  it("does not move on twice when the same hold is forgotten twice, and does not forget a different hold", async () => {
    const planId = await seedPlan();
    await store.saveHoldId(planId, memberId, 0, "pi_old");
    await store.clearHold(planId, memberId, "pi_old");
    await store.clearHold(planId, memberId, "pi_old");
    expect(await store.find(planId, memberId)).toMatchObject({ ok: true, value: { holdAttempt: 1 } });

    await store.saveHoldId(planId, memberId, 1, "pi_new");
    await store.clearHold(planId, memberId, "pi_something_else");
    expect(await store.find(planId, memberId)).toMatchObject({ ok: true, value: { holdId: "pi_new", holdAttempt: 1 } });
  }, 30_000);

  it("refuses to save a hold for an attempt the member has moved past", async () => {
    const planId = await seedPlan();
    await store.saveHoldId(planId, memberId, 0, "pi_old");
    await store.clearHold(planId, memberId, "pi_old");
    const stale = await store.saveHoldId(planId, memberId, 0, "pi_late");
    expect(stale.ok ? null : stale.error.code).toBe("stale");
    expect(await store.find(planId, memberId)).toMatchObject({ ok: true, value: { holdId: null } });
  }, 30_000);
});
