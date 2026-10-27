import { err, ok, type Result } from "@/lib/result";
import { applyPlanEvent } from "./apply-event";
import type { EffectError, EffectRunner } from "./effects";
import type { PlanRepository } from "./repository";
import type { PlanEffect } from "./types";

/**
 * For trying the whole money path out before real booking exists: answers every request to book by saying the
 * booking succeeded, so the holds are then charged for real (in Stripe's test mode). Nothing is booked anywhere. It
 * must never run in production; the server refuses to start it there.
 */
export class SimulatedBookingRunner implements EffectRunner {
  constructor(
    private readonly plans: PlanRepository,
    /** Where the effects of "the booking succeeded" go, which is the whole set of runners, this one included. */
    private readonly onward: () => EffectRunner,
    private readonly clock: () => Date,
  ) {}

  async run(planId: string, _version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    for (const effect of effects) {
      if (effect.type !== "book") continue;

      // The plan is claimed before anything is "booked", as real booking will do, so it can no longer be changed or expired.
      const started = await applyPlanEvent(this.plans, planId, { type: "booking_started", at: this.clock() });
      if (!started.ok) {
        if (started.error.kind === "transition") continue;
        return err({ message: "The simulated booking could not start" });
      }
      const succeeded = await applyPlanEvent(this.plans, planId, { type: "booking_succeeded", at: this.clock() });
      if (!succeeded.ok) return succeeded.error.kind === "transition" ? ok(undefined) : err({ message: "The simulated booking could not be recorded" });

      const onward = await this.onward().run(planId, succeeded.value.version, succeeded.value.effects);
      if (!onward.ok) return onward;
    }
    return ok(undefined);
  }
}
