import { err, ok, type Result } from "@/lib/result";
import { effectKey, type EffectError, type EffectRunner } from "@/domain/plan/effects";
import type { PlanEffect } from "@/domain/plan/types";
import type { Database } from "./client";
import { effectLog } from "./schema";

/**
 * Writes down what the plan asked the outside world to do, as `pending` rows in `effect_log`, and does nothing
 * else. Holds, bookings and charges are not wired yet; this keeps the record they will be driven from. A row's
 * name is the plan, its version and its position, so recording the same effects twice leaves one row each.
 */
export class PostgresEffectRecorder implements EffectRunner {
  constructor(private readonly db: Database) {}

  async run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    if (effects.length === 0) return ok(undefined);
    try {
      await this.db
        .insert(effectLog)
        .values(effects.map((effect, index) => ({ planId, effectKey: effectKey(planId, version, index), type: effect.type, payload: { ...effect } })))
        .onConflictDoNothing({ target: effectLog.effectKey });
      return ok(undefined);
    } catch {
      return err({ message: "The effects could not be recorded" });
    }
  }
}
