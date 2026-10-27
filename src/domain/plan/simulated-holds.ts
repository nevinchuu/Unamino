import { err, ok, type Result } from "@/lib/result";
import { applyPlanEvent } from "./apply-event";
import type { EffectError, EffectRunner } from "./effects";
import type { PlanRepository } from "./repository";
import type { PlanEffect } from "./types";

/**
 * For trying the screens out before payments are connected: answers every request for a card hold by saying it
 * was placed. No card is involved and no money is held. It must never run in production; the server refuses to
 * start it there.
 */
export class SimulatedHoldRunner implements EffectRunner {
  constructor(
    private readonly plans: PlanRepository,
    /** Where the effects of "the hold was placed" go, which is the whole set of runners, this one included. */
    private readonly onward: () => EffectRunner,
    private readonly clock: () => Date,
  ) {}

  async run(planId: string, _version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    for (const effect of effects) {
      if (effect.type !== "place_hold") continue;
      const placed = await applyPlanEvent(this.plans, planId, { type: "hold_placed", at: this.clock(), memberId: effect.memberId });
      // A plan that moved on in the meantime (the member backed out, the price changed) no longer needs this hold.
      if (!placed.ok && placed.error.kind === "transition") continue;
      if (!placed.ok) return err({ message: "The simulated hold could not be recorded" });
      // Only the last hold sets anything in motion; the others leave nothing to pass on.
      if (placed.value.effects.length === 0) continue;
      const onward = await this.onward().run(planId, placed.value.version, placed.value.effects);
      if (!onward.ok) return onward;
    }
    return ok(undefined);
  }
}
