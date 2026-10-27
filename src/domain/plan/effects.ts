import { err, ok, type Result } from "@/lib/result";
import type { PlanEffect } from "./types";

export interface EffectError {
  readonly message: string;
}

/**
 * Does what the state machine asked for after a transition (hold a card, book, release). The plan has already
 * changed by the time effects run, so a failure here is reported to the caller, never rolled back.
 */
export interface EffectRunner {
  /** `version` is the plan version the effects came from. Together with each effect's position it names the effect, so running the same ones twice does the work once. */
  run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>>;
}

export const effectKey = (planId: string, version: number, index: number): string => `${planId}:${version}:${index}`;

/** Runs several runners, one after another. One failing does not stop the others, because each does a different job. */
export class CompositeEffectRunner implements EffectRunner {
  constructor(private readonly runners: readonly EffectRunner[]) {}

  async run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    const failures: string[] = [];
    for (const runner of this.runners) {
      const ran = await runner.run(planId, version, effects);
      if (!ran.ok) failures.push(ran.error.message);
    }
    return failures.length === 0 ? ok(undefined) : err({ message: failures.join("; ") });
  }
}
