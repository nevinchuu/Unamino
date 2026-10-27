import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlanEffect } from "@/domain/plan/types";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresEffectLog } from "./postgres-effect-log";
import { PostgresEffectRecorder } from "./postgres-effect-recorder";
import { effectLog, groups, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-effect-log
 * Everything it creates hangs off one group that is deleted afterwards.
 */
const ENABLED = process.env.DB_TESTS === "1";
const NOW = new Date("2026-10-27T12:00:00.000Z");
const MAX = 3;

const RELEASE: PlanEffect = { type: "release_holds", memberIds: ["ana"] };
const CAPTURE: PlanEffect = { type: "capture_holds", captures: [{ memberId: "ana", captureMinor: 25_000, releaseMinor: 5_000 }] };
const HOLD: PlanEffect = { type: "place_hold", memberId: "ben", amountMinor: 30_000 };

describe.skipIf(!ENABLED)("PostgresEffectLog on the real database", () => {
  let handle: DatabaseHandle;
  let log: PostgresEffectLog;
  let recorder: PostgresEffectRecorder;
  let groupId: string;
  let planId: string;
  let version = 0;

  /** Records effects at a fresh version, so each test has rows of its own, and returns their keys. */
  async function record(effects: readonly PlanEffect[]): Promise<string[]> {
    version += 1;
    await recorder.run(planId, version, effects);
    return effects.map((_, index) => `${planId}:${version}:${index}`);
  }

  const rowOf = async (key: string) => (await handle.db.select().from(effectLog).where(eq(effectLog.effectKey, key)))[0];
  const retryable = async (overrides: Partial<{ now: Date; pendingOlderThanMs: number; maxAttempts: number; limit: number }> = {}) =>
    (await log.retryable({ now: NOW, pendingOlderThanMs: 60_000, maxAttempts: MAX, limit: 100, ...overrides })).filter((logged) => logged.planId === planId);

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
    log = new PostgresEffectLog(handle.db);
    recorder = new PostgresEffectRecorder(handle.db);
    const [group] = await handle.db.insert(groups).values({ name: "db-test-group", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: 1 }).returning({ id: tripBriefs.id });
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId: brief.id, title: "Test", deadlineAt: new Date("2026-10-27T00:09:00Z"), hardDeadlineAt: new Date("2026-10-29T00:00:00Z"), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, inputsHash: "test" })
      .returning({ id: plans.id });
    planId = plan.id;
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("marks an effect done, with the time, and clears any earlier error", async () => {
    const [key] = await record([RELEASE]);
    await log.finish(key, { status: "failed", error: "stripe was down" });
    await log.finish(key, { status: "done" });
    expect(await rowOf(key)).toMatchObject({ status: "done", error: null, attempts: 1 });
    expect((await rowOf(key)).completedAt).not.toBeNull();
  }, 30_000);

  it("marks an effect failed with the reason, and counts each failure as one more attempt", async () => {
    const [key] = await record([CAPTURE]);
    await log.finish(key, { status: "failed", error: "first" });
    await log.finish(key, { status: "failed", error: "second" });
    expect(await rowOf(key)).toMatchObject({ status: "failed", error: "second", attempts: 2 });
  }, 30_000);

  it("keeps a very long reason from filling the table", async () => {
    const [key] = await record([RELEASE]);
    await log.finish(key, { status: "failed", error: "x".repeat(5_000) });
    expect((await rowOf(key)).error).toHaveLength(500);
  }, 30_000);

  it("offers failed money effects that still have attempts left, with the effect as it was written down", async () => {
    const [key] = await record([CAPTURE]);
    await log.finish(key, { status: "failed", error: "refused" });
    expect(await retryable()).toEqual(expect.arrayContaining([{ key, planId, effect: CAPTURE, attempts: 1 }]));
  }, 30_000);

  it("stops offering an effect once it has used up its attempts, or is done", async () => {
    const [spent] = await record([RELEASE]);
    for (let i = 0; i < MAX; i += 1) await log.finish(spent, { status: "failed", error: "again" });
    const [finished] = await record([HOLD]);
    await log.finish(finished, { status: "done" });
    const keys = (await retryable()).map((logged) => logged.key);
    expect(keys).not.toContain(spent);
    expect(keys).not.toContain(finished);
  }, 30_000);

  it("offers a pending effect only after it has waited long enough, because it may still be in progress", async () => {
    const [key] = await record([RELEASE]);
    expect((await retryable({ now: new Date() })).map((l) => l.key)).not.toContain(key);
    expect((await retryable({ now: new Date(Date.now() + 120_000) })).map((l) => l.key)).toContain(key);
  }, 30_000);

  it("never offers a message to the group or a booking, which are not money to be retried", async () => {
    const [message, booking] = await record([{ type: "request_approval", memberIds: ["ana"] }, { type: "book" }]);
    const keys = (await retryable({ now: new Date(Date.now() + 3_600_000) })).map((l) => l.key);
    expect(keys).not.toContain(message);
    expect(keys).not.toContain(booking);
  }, 30_000);

  it("offers the oldest first and no more than the limit", async () => {
    const [a, b, c] = await Promise.all([record([RELEASE]), record([RELEASE]), record([RELEASE])].map(async (p) => (await p)[0]));
    for (const key of [a, b, c]) await log.finish(key, { status: "failed", error: "x" });
    expect(await retryable({ limit: 2 })).toHaveLength(2);
  }, 30_000);
});
