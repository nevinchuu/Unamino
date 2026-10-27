import type { Result } from "@/lib/result";
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
