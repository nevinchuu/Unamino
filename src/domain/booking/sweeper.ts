import type { EffectError } from "@/domain/plan/effects";
import type { Result } from "@/lib/result";
import type { SupplierBookingRunner } from "./booking-runner";
import type { SupplierBookingStore } from "./ports";

/** A plan that has been booking this long is not coming back: the supplier calls take well under a minute. */
export const STUCK_AFTER_MS = 10 * 60_000;
/**
 * A plan that has been "everyone has approved" (held) this long without booking started has lost its request to book: the last hold
 * is followed by booking within seconds. It is well under the time a plan has before its deadline, and long enough that
 * the normal booking, which starts straight after the response, is never raced.
 */
export const BOOK_OVERDUE_AFTER_MS = 2 * 60_000;
/** Booking asks an airline and a hotel and takes tens of seconds, so one sweep starts only a few. The next picks up the rest. */
export const BOOK_BATCH = 3;

export interface SweepSummary {
  /** Plans that were stuck booking and were ended. */
  readonly settled: number;
  /** Plans that were waiting to be booked and were booked now (or ended, if booking failed and was undone). */
  readonly booked: number;
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
    private readonly bookings: Pick<SupplierBookingStore, "stuckPlans" | "isStuck" | "stalledPlans" | "isStalled" | "unsettledPlans">,
    private readonly runner: Pick<SupplierBookingRunner, "settleStuck" | "cancelBookings" | "run">,
    private readonly clock: () => Date,
  ) {}

  async sweep(limit: number): Promise<SweepSummary> {
    const counts = { settled: 0, booked: 0, cancelled: 0, failed: 0 };

    const stuck = await this.bookings.stuckPlans(this.stuckBefore(), limit);
    if (stuck.ok) {
      for (const planId of stuck.value) this.count(await this.runner.settleStuck(planId), counts, "settled");
    } else {
      counts.failed += 1;
    }

    // Booking is claimed by moving the plan out of "held", so a plan already being booked, or booked, is left alone.
    const stalled = await this.bookings.stalledPlans(this.stalledBefore(), Math.min(limit, BOOK_BATCH));
    if (stalled.ok) {
      for (const planId of stalled.value) this.count(await this.book(planId), counts, "booked");
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
    if (stuck.ok && stuck.value) {
      await this.runner.settleStuck(planId);
      return;
    }
    const stalled = await this.bookings.isStalled(planId, this.stalledBefore());
    if (stalled.ok && stalled.value) await this.book(planId);
  }

  private book(planId: string): Promise<Result<void, EffectError>> {
    return this.runner.run(planId, 0, [{ type: "book" }]);
  }

  private stalledBefore(): Date {
    return new Date(this.clock().getTime() - BOOK_OVERDUE_AFTER_MS);
  }

  private stuckBefore(): Date {
    return new Date(this.clock().getTime() - STUCK_AFTER_MS);
  }

  private count(done: Result<void, EffectError>, counts: { settled: number; booked: number; cancelled: number; failed: number }, success: "settled" | "booked" | "cancelled"): void {
    if (done.ok) counts[success] += 1;
    else counts.failed += 1;
  }
}
