import { err, ok, type Result } from "@/lib/result";
import { WORK_EFFECT_TYPES } from "@/domain/plan/effect-log";
import { effectKey, type EffectError, type EffectRunner } from "@/domain/plan/effects";
import type { PlanEffect } from "@/domain/plan/types";
import type { Database } from "./client";
import { effectLog } from "./schema";

const isWork = (effect: PlanEffect): boolean => (WORK_EFFECT_TYPES as readonly string[]).includes(effect.type);

/**
 * Writes down what the plan asked the outside world to do, in `effect_log`. Work still to be done (a hold, a release,
 * a charge, a booking) starts as `pending` for whoever does it to mark as done or failed; a message to the group is
 * done the moment it is written down. A row's name is the plan, its version and its position, so recording the same
 * effects twice leaves one row each.
 */
export class PostgresEffectRecorder implements EffectRunner {
  constructor(private readonly db: Database) {}

  async run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    if (effects.length === 0) return ok(undefined);
    const now = new Date();
    try {
      await this.db
        .insert(effectLog)
        .values(
          effects.map((effect, index) => ({
            planId,
            effectKey: effectKey(planId, version, index),
            type: effect.type,
            payload: { ...effect },
            ...(isWork(effect) ? {} : { status: "done" as const, completedAt: now }),
          })),
        )
        .onConflictDoNothing({ target: effectLog.effectKey });
      return ok(undefined);
    } catch {
      return err({ message: "The effects could not be recorded" });
    }
  }
}
