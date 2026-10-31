import type { EffectLog } from "@/domain/plan/effect-log";
import type { PlanEffect } from "@/domain/plan/types";
import type { PaymentEffectRunner } from "./payment-effects";

/** How many times a money effect is tried before it is given up on and a person is told. */
export const MAX_EFFECT_ATTEMPTS = 5;
/** A pending effect this old was probably never tried, because the server stopped first. */
export const PENDING_RETRY_AFTER_MS = 2 * 60_000;

export interface RetrySummary {
  readonly tried: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Failed for the last time: it will not be tried again, and the group was told. */
  readonly gaveUp: number;
}

export interface EffectRetrierDeps {
  readonly log: Pick<EffectLog, "finish" | "retryable">;
  readonly runner: Pick<PaymentEffectRunner, "runEffect">;
  /** Tells the group (and so a person) that something could not be done and needs attention. */
  readonly onGaveUp: (planId: string, effect: PlanEffect) => Promise<void>;
  readonly clock: () => Date;
  readonly maxAttempts?: number;
  readonly pendingAfterMs?: number;
  readonly limit?: number;
}

const BATCH = 25;

/** Which effects to retry when it is not all of them: one plan's, with a failed one left alone until its last try is this old. */
export interface RetryOnly {
  readonly planId: string;
  readonly failedOlderThanMs: number;
}

/** What to tell the group when a money effect could not be done after every try. Never an amount or anyone's card. */
export function giveUpLine(effect: PlanEffect): string | null {
  switch (effect.type) {
    case "capture_holds":
      return "Some payments could not be taken after booking, so the organiser will need to sort this out. Nobody has been charged more than they approved.";
    case "release_holds":
      return "A card hold could not be released automatically. It will expire on its own, usually within about a week, and nothing will be charged for it.";
    case "place_hold":
      return "A card hold could not be set up. The person can open the plan and try again.";
    case "request_review":
    case "request_approval":
    case "request_reapproval":
    case "book":
      return null;
  }
}

/**
 * Does again what failed. It runs on a timer, so a hold that could not be released, or a charge that could not be
 * taken, because a payment service was briefly down, is not forgotten. It is safe to run any number of times: what
 * already worked is not done twice. After the last attempt it stops and the group is told.
 */
export class EffectRetrier {
  constructor(private readonly deps: EffectRetrierDeps) {}

  /** `only` narrows it to one plan's effects, and leaves a failed effect alone until its last try is a while old. */
  async retry(only?: RetryOnly): Promise<RetrySummary> {
    const maxAttempts = this.deps.maxAttempts ?? MAX_EFFECT_ATTEMPTS;
    const due = await this.deps.log.retryable({ now: this.deps.clock(), pendingOlderThanMs: this.deps.pendingAfterMs ?? PENDING_RETRY_AFTER_MS, maxAttempts, limit: this.deps.limit ?? BATCH, ...only });

    let succeeded = 0;
    let failed = 0;
    let gaveUp = 0;
    for (const logged of due) {
      const failure = await this.deps.runner.runEffect(logged.planId, logged.effect);
      if (failure === null) {
        await this.deps.log.finish(logged.key, { status: "done" });
        succeeded += 1;
        continue;
      }
      await this.deps.log.finish(logged.key, { status: "failed", error: failure });
      failed += 1;
      // This failure was the last attempt that was allowed.
      if (logged.attempts + 1 >= maxAttempts) {
        await this.deps.onGaveUp(logged.planId, logged.effect);
        gaveUp += 1;
      }
    }
    return { tried: due.length, succeeded, failed, gaveUp };
  }
}
