import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlanEffect } from "@/domain/plan/types";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresEffectRecorder } from "./postgres-effect-recorder";
import { effectLog, groups, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-effect-recorder
 * Everything it creates hangs off one group that is deleted afterwards.
 */
const ENABLED = process.env.DB_TESTS === "1";
const EFFECTS: readonly PlanEffect[] = [
  { type: "request_review", memberIds: ["ana", "ben"] },
  { type: "place_hold", memberId: "ana", amountMinor: 30_000 },
];

describe.skipIf(!ENABLED)("PostgresEffectRecorder on the real database", () => {
  let handle: DatabaseHandle;
  let recorder: PostgresEffectRecorder;
  let groupId: string;
  let planId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
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

  const rows = () => handle.db.select().from(effectLog).where(eq(effectLog.planId, planId)).orderBy(asc(effectLog.effectKey));

  it("records each effect as a pending row with its details", async () => {
    expect(await recorder.run(planId, 3, EFFECTS)).toEqual({ ok: true, value: undefined });
    const stored = await rows();
    expect(stored.map((row) => [row.effectKey, row.type, row.status])).toEqual([[`${planId}:3:0`, "request_review", "pending"], [`${planId}:3:1`, "place_hold", "pending"]]);
    expect(stored[1].payload).toMatchObject({ type: "place_hold", memberId: "ana", amountMinor: 30_000 });
  }, 30_000);

  it("leaves one row each when the same effects are recorded again", async () => {
    await recorder.run(planId, 3, EFFECTS);
    expect(await rows()).toHaveLength(2);
  }, 30_000);

  it("keeps effects of another version apart", async () => {
    await recorder.run(planId, 4, [EFFECTS[0]]);
    expect(await rows()).toHaveLength(3);
  }, 30_000);

  it("records nothing, and succeeds, for no effects", async () => {
    expect(await recorder.run(planId, 5, [])).toEqual({ ok: true, value: undefined });
    expect(await rows()).toHaveLength(3);
  }, 30_000);

  it("reports failure instead of throwing when the plan does not exist", async () => {
    const result = await recorder.run(randomUUID(), 1, EFFECTS);
    expect(result.ok).toBe(false);
  }, 30_000);
});
