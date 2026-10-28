import { err, ok, type Result } from "@/lib/result";
import { isMoneyEffect, type EffectLog } from "@/domain/plan/effect-log";
import { effectKey, type EffectError, type EffectRunner } from "@/domain/plan/effects";
import type { PlanEffect } from "@/domain/plan/types";
import type { HoldService } from "./hold-service";

/**
 * Does the money side of what the plan asks for: make a person's hold when they approve, let go of holds when the
 * plan ends or a price passes someone's cap, and charge the holds once the trip is booked. Everything else is
 * somebody else's job. How each one went is written in the effect log, so what failed can be done again later. A
 * hold that could not be made yet is not a failure to report, because the card form makes it when the person opens it.
 */
export interface PaymentEffectOptions {
  /**
   * How many times a charge is tried right away before it is left to the scheduled retry. The trip is already booked
   * by then, so a charge that failed for a moment should not wait for the next sweep. Charges already made are not
   * made again, so trying more than once is safe.
   */
  readonly captureAttempts?: number;
  readonly pause?: (ms: number) => Promise<void>;
}

const CAPTURE_PAUSE_MS = 2_000;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class PaymentEffectRunner implements EffectRunner {
  private readonly captureAttempts: number;
  private readonly pause: (ms: number) => Promise<void>;

  constructor(
    private readonly holds: Pick<HoldService, "ensureHold" | "releaseHolds" | "captureHolds">,
    private readonly log?: Pick<EffectLog, "finish">,
    options: PaymentEffectOptions = {},
  ) {
    this.captureAttempts = Math.max(1, options.captureAttempts ?? 1);
    this.pause = options.pause ?? wait;
  }

  async run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    const failures: string[] = [];
    for (const [index, effect] of effects.entries()) {
      const failure = await this.runEffect(planId, effect);
      if (failure) failures.push(failure);
      if (isMoneyEffect(effect)) await this.log?.finish(effectKey(planId, version, index), failure ? { status: "failed", error: failure } : { status: "done" });
    }
    return failures.length === 0 ? ok(undefined) : err({ message: failures.join("; ") });
  }

  /** Does one effect. Returns what went wrong, or null when it was done or is not one of ours. Safe to run again. */
  async runEffect(planId: string, effect: PlanEffect): Promise<string | null> {
    switch (effect.type) {
      case "place_hold": {
        const made = await this.holds.ensureHold(planId, effect.memberId);
        return made.ok || made.error.kind === "not_applicable" ? null : made.error.message;
      }
      case "release_holds": {
        const released = await this.holds.releaseHolds(planId, effect.memberIds);
        return released.ok ? null : released.error.message;
      }
      case "capture_holds": {
        let failure = "";
        for (let attempt = 1; attempt <= this.captureAttempts; attempt += 1) {
          const captured = await this.holds.captureHolds(planId, effect.captures);
          if (captured.ok) return null;
          failure = captured.error.message;
          if (attempt < this.captureAttempts) await this.pause(CAPTURE_PAUSE_MS);
        }
        return failure;
      }
      case "request_review":
      case "request_approval":
      case "request_reapproval":
      case "book":
        return null;
    }
  }
}
