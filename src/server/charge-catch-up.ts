import type { EffectRetrier, RetrySummary } from "@/domain/payments/effect-retrier";

/** How long a plan is left alone after it was looked at, so a screen that asks every few seconds does not start the work every time. */
export const CATCH_UP_GAP_MS = 60_000;
/** A charge that failed is not tried again until its last try is this old, so five tries are spread over minutes and not used up in one outage. */
export const CHARGE_RETRY_GAP_MS = 2 * 60_000;
/** How many plans are remembered as just looked at. The memory only saves work, so forgetting it is harmless. */
const MAX_REMEMBERED = 200;

/**
 * Takes the charges of a booked plan that failed, or never ran, once someone looks at it. Without this a charge that
 * failed for a moment would wait for the next scheduled retry, which on the free plan can be a day away, while the
 * trip is booked and some people have been charged and others not.
 */
export class ChargeCatchUp {
  private readonly checkedAt = new Map<string, number>();

  constructor(private readonly deps: { readonly retrier: Pick<EffectRetrier, "retry">; readonly clock: () => Date }) {}

  /** What the retry did, or null when this plan was looked at too recently. */
  async catchUp(planId: string): Promise<RetrySummary | null> {
    const now = this.deps.clock().getTime();
    const last = this.checkedAt.get(planId);
    if (last !== undefined && now - last < CATCH_UP_GAP_MS) return null;
    if (this.checkedAt.size >= MAX_REMEMBERED) this.checkedAt.clear();
    this.checkedAt.set(planId, now);
    return this.deps.retrier.retry({ planId, failedOlderThanMs: CHARGE_RETRY_GAP_MS });
  }
}
