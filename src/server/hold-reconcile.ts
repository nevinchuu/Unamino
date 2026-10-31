import type { HoldService } from "@/domain/payments/hold-service";
import type { PlanViewRaw } from "@/domain/plan/view-store";

/** How long a plan is left alone after it was checked, so a screen that asks every few seconds does not ask the payment provider every time. */
export const RECONCILE_GAP_MS = 20_000;
/** How many plans are remembered as just checked. The memory only saves calls, so forgetting it is harmless. */
const MAX_REMEMBERED = 200;

/**
 * Makes sure a hold that really was placed is recorded, even when nothing told the app about it. The card form reports a
 * placed hold itself, and Stripe can report it by webhook, but a person can close the page in between and the webhook
 * may not be set up. So whoever looks at a plan that is waiting for holds asks the payment provider about each person who
 * has approved but has no hold recorded. `confirmHold` checks the provider's real answer, for this person, plan and
 * amount, so this can never place a hold that is not there, and asking again is harmless.
 */
export class HoldReconciler {
  private readonly checkedAt = new Map<string, number>();

  constructor(private readonly deps: { readonly holds: Pick<HoldService, "confirmHold">; readonly clock: () => Date }) {}

  /** How many holds were recorded by this check. A failure to reach the provider or the database is left for the next look. */
  async reconcile(plan: Pick<PlanViewRaw, "id" | "status" | "members">): Promise<number> {
    if (plan.status !== "approving") return 0;
    const now = this.deps.clock().getTime();
    const last = this.checkedAt.get(plan.id);
    if (last !== undefined && now - last < RECONCILE_GAP_MS) return 0;
    this.remember(plan.id, now);

    let recorded = 0;
    for (const member of plan.members) {
      if (member.approval !== "approved" || member.holdPlaced) continue;
      const confirmed = await this.deps.holds.confirmHold(plan.id, member.id);
      if (confirmed.ok && confirmed.value.status === "placed") recorded += 1;
    }
    return recorded;
  }

  private remember(planId: string, at: number): void {
    if (this.checkedAt.size >= MAX_REMEMBERED) this.checkedAt.clear();
    this.checkedAt.set(planId, at);
  }
}
