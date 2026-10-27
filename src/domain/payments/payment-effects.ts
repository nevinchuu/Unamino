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
export class PaymentEffectRunner implements EffectRunner {
  constructor(
    private readonly holds: Pick<HoldService, "ensureHold" | "releaseHolds" | "captureHolds">,
    private readonly log?: Pick<EffectLog, "finish">,
  ) {}

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
        const captured = await this.holds.captureHolds(planId, effect.captures);
        return captured.ok ? null : captured.error.message;
      }
      case "request_review":
      case "request_approval":
      case "request_reapproval":
      case "book":
        return null;
    }
  }
}
