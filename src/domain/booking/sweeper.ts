import type { EffectError } from "@/domain/plan/effects";
import type { Result } from "@/lib/result";
import type { SupplierBookingRunner } from "./booking-runner";
import type { SupplierBookingStore } from "./ports";

/** A plan that has been booking this long is not coming back: the supplier calls take well under a minute. */
export const STUCK_AFTER_MS = 10 * 60_000;

export interface SweepSummary {
  /** Plans that were stuck booking and were ended. */
  readonly settled: number;
  /** Ended plans whose supplier bookings were asked to be cancelled again. */
  readonly cancelled: number;
  /** Plans the sweep could not finish. They are picked up again next time. */
  readonly failed: number;
}

/**
 * The clock's part of booking. It ends plans stuck in "booking" (letting go of their holds and cancelling what was
 * booked), and it asks again for any cancellation that did not finish, such as an airline that was still thinking.
 */
export class BookingSweeper {
  constructor(
    private readonly bookings: Pick<SupplierBookingStore, "stuckPlans" | "isStuck" | "unsettledPlans">,
    private readonly runner: Pick<SupplierBookingRunner, "settleStuck" | "cancelBookings">,
    private readonly clock: () => Date,
  ) {}

  async sweep(limit: number): Promise<SweepSummary> {
    const counts = { settled: 0, cancelled: 0, failed: 0 };

    const stuck = await this.bookings.stuckPlans(this.stuckBefore(), limit);
    if (stuck.ok) {
      for (const planId of stuck.value) this.count(await this.runner.settleStuck(planId), counts, "settled");
    } else {
      counts.failed += 1;
    }

    const unsettled = await this.bookings.unsettledPlans(limit);
    if (unsettled.ok) {
      for (const planId of unsettled.value) this.count(await this.runner.cancelBookings(planId), counts, "cancelled");
    } else {
      counts.failed += 1;
    }
    return counts;
  }

  /** The same for one plan, for when someone is looking at it and the clock has not come round yet. */
  async settlePlan(planId: string): Promise<void> {
    const stuck = await this.bookings.isStuck(planId, this.stuckBefore());
    if (stuck.ok && stuck.value) await this.runner.settleStuck(planId);
  }

  private stuckBefore(): Date {
    return new Date(this.clock().getTime() - STUCK_AFTER_MS);
  }

  private count(done: Result<void, EffectError>, counts: { settled: number; cancelled: number; failed: number }, success: "settled" | "cancelled"): void {
    if (done.ok) counts[success] += 1;
    else counts.failed += 1;
  }
}
