import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { MONEY_EFFECT_TYPES, type EffectLog, type EffectOutcome, type LoggedEffect, type RetryableQuery } from "@/domain/plan/effect-log";
import type { PlanEffect } from "@/domain/plan/types";
import type { Database } from "./client";
import { effectLog } from "./schema";

/** Reads and updates the record of what plans asked of the outside world. */
export class PostgresEffectLog implements EffectLog {
  constructor(private readonly db: Database) {}

  async finish(key: string, outcome: EffectOutcome): Promise<void> {
    await this.db
      .update(effectLog)
      .set(
        outcome.status === "done"
          ? { status: "done", error: null, completedAt: new Date() }
          : { status: "failed", error: outcome.error.slice(0, 500), attempts: sql`${effectLog.attempts} + 1`, completedAt: new Date() },
      )
      .where(eq(effectLog.effectKey, key));
  }

  async retryable(input: RetryableQuery): Promise<readonly LoggedEffect[]> {
    const staleBefore = new Date(input.now.getTime() - input.pendingOlderThanMs);
    const lastTriedBefore = input.failedOlderThanMs === undefined ? undefined : new Date(input.now.getTime() - input.failedOlderThanMs);
    const failedAndDue = and(eq(effectLog.status, "failed"), lt(effectLog.attempts, input.maxAttempts), lastTriedBefore && lt(effectLog.completedAt, lastTriedBefore));
    const rows = await this.db
      .select()
      .from(effectLog)
      .where(and(inArray(effectLog.type, [...MONEY_EFFECT_TYPES]), input.planId === undefined ? undefined : eq(effectLog.planId, input.planId), or(failedAndDue, and(eq(effectLog.status, "pending"), lt(effectLog.createdAt, staleBefore)))))
      .orderBy(asc(effectLog.createdAt), asc(effectLog.id))
      .limit(input.limit);
    return rows.map((row) => ({ key: row.effectKey, planId: row.planId, effect: row.payload as unknown as PlanEffect, attempts: row.attempts }));
  }
}
