import { err, ok, type Result } from "@/lib/result";
import type { EffectError, EffectRunner } from "@/domain/plan/effects";
import type { PlanEffect } from "@/domain/plan/types";
import type { TravellerService } from "./service";

/** The people whose details have done their job: the trip was booked for them, or the plan ended before it was. */
function finishedMembers(effects: readonly PlanEffect[]): readonly string[] {
  const ids = new Set<string>();
  for (const effect of effects) {
    if (effect.type === "release_holds") effect.memberIds.forEach((id) => ids.add(id));
    // This is asked for exactly when booking has succeeded, and the booking has already read the details.
    if (effect.type === "capture_holds") effect.captures.forEach((capture) => ids.add(capture.memberId));
  }
  return [...ids];
}

/**
 * Deletes travellers' passport details as soon as they are no longer needed, as the form promises. Deleting twice
 * is harmless, so running the same effects again is safe.
 */
export class TravellerCleanupRunner implements EffectRunner {
  constructor(private readonly travellers: Pick<TravellerService, "forget">) {}

  async run(_planId: string, _version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    const members = finishedMembers(effects);
    if (members.length === 0) return ok(undefined);
    const forgotten = await this.travellers.forget(members);
    return forgotten.ok ? ok(undefined) : err({ message: "Traveller details could not be deleted" });
  }
}
