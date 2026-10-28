import { ok, type Result } from "@/lib/result";
import type { EffectError, EffectRunner } from "@/domain/plan/effects";
import type { PlanEffect } from "@/domain/plan/types";

/** Runs a task after the response has gone out (Next's `after`), without holding the person up. */
export type Defer = (task: () => Promise<unknown>) => void;

/**
 * Hands the booking to be done after the response. Booking asks an airline and a hotel, which takes tens of seconds,
 * and the person who placed the last card hold should not sit waiting on it. Only the request to book is deferred;
 * the answer here is only that it was handed over. If the work fails or the server stops, the plan stays in
 * "booking" and is settled by the sweep, which cancels what was booked and lets go of the holds.
 */
export class DeferredBookingRunner implements EffectRunner {
  constructor(
    private readonly inner: EffectRunner,
    private readonly defer: Defer,
  ) {}

  async run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    const bookings = effects.filter((effect) => effect.type === "book");
    if (bookings.length === 0) return ok(undefined);
    this.defer(async () => {
      try {
        const done = await this.inner.run(planId, version, bookings);
        if (!done.ok) console.error("booking failed", planId);
      } catch {
        console.error("booking stopped unexpectedly", planId);
      }
    });
    return ok(undefined);
  }
}
