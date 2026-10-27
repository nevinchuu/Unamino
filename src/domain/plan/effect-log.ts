import type { PlanEffect } from "./types";

/** An effect that still needs doing, as it was written down when the plan asked for it. */
export interface LoggedEffect {
  readonly key: string;
  readonly planId: string;
  readonly effect: PlanEffect;
  /** How many times doing it has failed so far. */
  readonly attempts: number;
}

export type EffectOutcome = { readonly status: "done" } | { readonly status: "failed"; readonly error: string };

/** What was asked of the outside world and how it went, so that what failed can be done again and nothing is done twice. */
export interface EffectLog {
  /** Writes down how an effect went. A failure counts as one more attempt. */
  finish(key: string, outcome: EffectOutcome): Promise<void>;
  /**
   * The money effects that still need doing: those that failed and have attempts left, and those still pending long
   * after they were asked for (the server stopped before it could try). Oldest first.
   */
  retryable(input: { readonly now: Date; readonly pendingOlderThanMs: number; readonly maxAttempts: number; readonly limit: number }): Promise<readonly LoggedEffect[]>;
}

/** The effects that are work to be done later, as opposed to messages that are done the moment they are written down. */
export const WORK_EFFECT_TYPES = ["place_hold", "release_holds", "capture_holds", "book"] as const;

/** The effects that move money, which are the ones worth retrying. */
export const MONEY_EFFECT_TYPES = ["place_hold", "release_holds", "capture_holds"] as const;

export const isMoneyEffect = (effect: PlanEffect): boolean => (MONEY_EFFECT_TYPES as readonly string[]).includes(effect.type);
