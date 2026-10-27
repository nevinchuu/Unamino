import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPlanEvent } from "@/domain/plan/apply-event";
import type { PlanSnapshot } from "@/domain/plan/types";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresPlanRepository } from "./postgres-plan-repository";
import { groups, members, planMembers, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-plan-repository
 * Everything it creates hangs off one group that is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const NAMES = ["ana", "ben", "jia"] as const;
const T0 = new Date("2026-10-27T00:00:00.000Z");
const DEADLINE = new Date("2026-10-27T00:09:00.000Z");
const HARD = new Date("2026-10-29T00:00:00.000Z");

describe.skipIf(!ENABLED)("PostgresPlanRepository on the real database", () => {
  let handle: DatabaseHandle;
  let repository: PostgresPlanRepository;
  let groupId: string;
  let briefId: string;
  const memberIds: string[] = [];

  /** A fresh plan in review with all three members, in the state the state machine starts from. */
  async function seedPlan(status: "reviewing" | "approving" | "held" = "reviewing"): Promise<string> {
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId, status, title: "Test trip", deadlineAt: DEADLINE, hardDeadlineAt: HARD, baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: NAMES.length, inputsHash: "test" })
      .returning({ id: plans.id });
    await handle.db.insert(planMembers).values(memberIds.map((memberId) => ({ planId: plan.id, memberId })));
    return plan.id;
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 8);
    repository = new PostgresPlanRepository(handle.db);

    const [group] = await handle.db.insert(groups).values({ name: "db-test-group", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    // One statement each, so they get different creation times and a known order.
    for (const name of NAMES) {
      const [row] = await handle.db
        .insert(members)
        .values({ groupId, displayName: name, currency: "USD", status: "joined", joinedAt: T0, inviteTokenHash: randomUUID() })
        .returning({ id: members.id });
      memberIds.push(row.id);
    }
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: NAMES.length }).returning({ id: tripBriefs.id });
    briefId = brief.id;
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    // plans reference briefs, so the plans go first; everything else follows the group.
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("loads a plan with its people in the order they were added", async () => {
    const planId = await seedPlan();
    const loaded = await repository.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.value.version).toBe(1);
    expect(loaded.value.plan.status).toBe("reviewing");
    expect(loaded.value.plan.deadlineAt).toEqual(DEADLINE);
    expect(loaded.value.plan.hardDeadlineAt).toEqual(HARD);
    expect(loaded.value.plan.members.map((m) => m.id)).toEqual(memberIds);
    expect(loaded.value.plan.members[0]).toMatchObject({ planAgreement: "pending", approval: "pending", approvedMinor: null, holdPlaced: false, approvalExpiresAt: null });
  }, 30_000);

  it("reports a plan that does not exist", async () => {
    const result = await repository.load(randomUUID());
    expect(result.ok ? null : result.error.code).toBe("not_found");
  });

  it("saves every field and moves the version up by one", async () => {
    const planId = await seedPlan("approving");
    const loaded = await repository.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const expires = new Date("2026-10-27T00:08:00.000Z");
    const next: PlanSnapshot = {
      ...loaded.value.plan,
      deadlineAt: new Date("2026-10-27T00:18:00.000Z"),
      members: loaded.value.plan.members.map((m, index) => ({
        ...m,
        planAgreement: "agreed",
        agreedShareMinor: 20000 + index,
        approval: "approved",
        approvedMinor: 21000,
        currentShareMinor: 20500,
        approvalExpiresAt: expires,
        holdPlaced: true,
      })),
    };
    const saved = await repository.save(loaded.value, next);
    expect(saved.ok && saved.value.version).toBe(2);

    const again = await repository.load(planId);
    expect(again.ok && again.value.version).toBe(2);
    expect(again.ok && again.value.plan).toEqual(next);
  }, 30_000);

  it("refuses a save made from an old version and changes nothing", async () => {
    const planId = await seedPlan();
    const first = await repository.load(planId);
    if (!first.ok) throw new Error(first.error.message);
    await repository.save(first.value, { ...first.value.plan, status: "expired" });

    // A second writer still holding version 1.
    const stale = await repository.save(first.value, { ...first.value.plan, status: "approving" });
    expect(stale.ok ? null : stale.error.code).toBe("version_conflict");

    const after = await repository.load(planId);
    expect(after.ok && after.value.plan.status).toBe("expired");
    expect(after.ok && after.value.version).toBe(2);
  }, 30_000);

  it("lets exactly one of two simultaneous saves win", async () => {
    const planId = await seedPlan();
    const loaded = await repository.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);

    const results = await Promise.all([
      repository.save(loaded.value, { ...loaded.value.plan, status: "approving" }),
      repository.save(loaded.value, { ...loaded.value.plan, status: "expired" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.code === "version_conflict")).toHaveLength(1);

    const final = await repository.load(planId);
    expect(final.ok && final.value.version).toBe(2);
  }, 30_000);

  it("rolls the whole save back when the snapshot names someone who is not in the plan", async () => {
    const planId = await seedPlan();
    const loaded = await repository.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);

    const stranger = { ...loaded.value.plan.members[0], id: randomUUID() };
    const result = await repository.save(loaded.value, { ...loaded.value.plan, status: "expired", members: [...loaded.value.plan.members.slice(0, 2), stranger] });
    expect(result.ok ? null : result.error.code).toBe("member_mismatch");

    const after = await repository.load(planId);
    expect(after.ok && after.value.version).toBe(1);
    expect(after.ok && after.value.plan.status).toBe("reviewing");
  }, 30_000);

  it("refuses a snapshot that leaves someone out, because their old state would silently stay", async () => {
    const planId = await seedPlan();
    const loaded = await repository.load(planId);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const result = await repository.save(loaded.value, { ...loaded.value.plan, members: loaded.value.plan.members.slice(0, 2) });
    expect(result.ok ? null : result.error.code).toBe("member_mismatch");
    const after = await repository.load(planId);
    expect(after.ok && after.value.version).toBe(1);
  }, 30_000);

  it("keeps both of two members' agreements when they agree at the same instant", async () => {
    const planId = await seedPlan();
    const [ana, ben] = memberIds;
    const [first, second] = await Promise.all([
      applyPlanEvent(repository, planId, { type: "plan_agreed", at: T0, memberId: ana, shareMinor: 20000 }),
      applyPlanEvent(repository, planId, { type: "plan_agreed", at: T0, memberId: ben, shareMinor: 21000 }),
    ]);
    expect(first.ok && second.ok).toBe(true);

    const after = await repository.load(planId);
    if (!after.ok) throw new Error(after.error.message);
    const byId = new Map(after.value.plan.members.map((m) => [m.id, m]));
    expect(byId.get(ana)?.planAgreement).toBe("agreed");
    expect(byId.get(ben)?.planAgreement).toBe("agreed");
    expect(byId.get(ana)?.agreedShareMinor).toBe(20000);
    expect(byId.get(ben)?.agreedShareMinor).toBe(21000);
    expect(after.value.plan.status).toBe("reviewing");
  }, 30_000);

  it("takes a plan through both approval steps, booking and capture, saving each step", async () => {
    const planId = await seedPlan();
    const steps: Parameters<typeof applyPlanEvent>[2][] = [];
    for (const memberId of memberIds) steps.push({ type: "plan_agreed", at: T0, memberId, shareMinor: 20000 });
    for (const memberId of memberIds) {
      steps.push({ type: "member_approved", at: T0, memberId, amountMinor: 21000, expiresAt: DEADLINE });
      steps.push({ type: "hold_placed", at: T0, memberId });
    }
    steps.push({ type: "booking_started", at: T0 }, { type: "booking_succeeded", at: T0 }, { type: "capture_succeeded", at: T0 });

    let last: Awaited<ReturnType<typeof applyPlanEvent>> | null = null;
    for (const event of steps) {
      last = await applyPlanEvent(repository, planId, event);
      if (!last.ok) throw new Error(`${event.type}: ${JSON.stringify(last.error)}`);
    }
    expect(last?.ok && last.value.plan.status).toBe("captured");
    expect(last?.ok && last.value.version).toBe(steps.length + 1);
    expect(last?.ok && last.value.plan.members.map((m) => m.chargedMinor)).toEqual([21000, 21000, 21000]);
  }, 60_000);

  it("stops a plan that has begun booking from being replaced", async () => {
    const planId = await seedPlan();
    for (const memberId of memberIds) await applyPlanEvent(repository, planId, { type: "plan_agreed", at: T0, memberId, shareMinor: 20000 });
    for (const memberId of memberIds) {
      await applyPlanEvent(repository, planId, { type: "member_approved", at: T0, memberId, amountMinor: 21000, expiresAt: DEADLINE });
      await applyPlanEvent(repository, planId, { type: "hold_placed", at: T0, memberId });
    }
    await applyPlanEvent(repository, planId, { type: "booking_started", at: T0 });

    const replaced = await applyPlanEvent(repository, planId, { type: "plan_replaced", at: T0 });
    expect(!replaced.ok && replaced.error.kind === "transition" && replaced.error.error.code).toBe("booking_in_progress");
  }, 60_000);

  it("claims the booking for only one of two runners that start at the same time", async () => {
    const planId = await seedPlan("held");
    await handle.db.update(planMembers).set({ planAgreement: "agreed", approval: "approved", approvedMinor: 21000, currentShareMinor: 21000, approvalExpiresAt: DEADLINE, holdPlaced: true }).where(eq(planMembers.planId, planId));

    const results = await Promise.all([
      applyPlanEvent(repository, planId, { type: "booking_started", at: T0 }),
      applyPlanEvent(repository, planId, { type: "booking_started", at: T0 }),
    ]);
    // The loser reloads, finds the plan already booking, and is refused instead of booking twice.
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.kind === "transition")).toHaveLength(1);
  }, 30_000);

  it("lets the database itself refuse a charge above the approved cap", async () => {
    const planId = await seedPlan();
    const attempt = handle.db.update(planMembers).set({ approvedMinor: 100, chargedMinor: 101 }).where(eq(planMembers.planId, planId));
    await expect(attempt).rejects.toThrow();
    const rows = await handle.db.select({ charged: planMembers.chargedMinor }).from(planMembers).where(eq(planMembers.planId, planId));
    expect(rows.every((row) => row.charged === null)).toBe(true);
  }, 30_000);

  it("is out of reach of the public API: row-level security is on for the plan tables", async () => {
    const rows = await handle.db.execute(sql`select relname, relrowsecurity from pg_class where relname in ('plans','plan_members') order by relname`);
    expect([...rows].map((r) => r.relrowsecurity)).toEqual([true, true]);
  }, 30_000);
});
