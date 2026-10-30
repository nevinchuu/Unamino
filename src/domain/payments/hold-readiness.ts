import { err, ok, type Result } from "@/lib/result";
import type { BookingStoreError, HoldReadiness } from "@/domain/booking/ports";
import type { HoldStore } from "./hold-store";
import type { PaymentProvider } from "./types";
import { checkHold } from "./verify";

/**
 * Asks the payment provider whether each person's card hold is still there, in full, for what they approved. A hold
 * can be lost between the last card being added and the booking (the bank let it lapse, or it was cancelled), and
 * booking a trip that cannot then be paid for is the one thing this app must never do.
 */
export class ProviderHoldReadiness implements HoldReadiness {
  constructor(
    private readonly store: Pick<HoldStore, "find">,
    private readonly provider: Pick<PaymentProvider, "getHold">,
  ) {}

  async problem(planId: string, memberIds: readonly string[]): Promise<Result<string | null, BookingStoreError>> {
    for (const memberId of memberIds) {
      const found = await this.store.find(planId, memberId);
      if (!found.ok) return err({ message: found.error.message });
      const { holdId, approvedMinor, currency } = found.value;
      // A friend covers all of their share, so there is no card hold to look for.
      if (approvedMinor === 0) continue;
      if (!holdId || approvedMinor === null) return ok("a member has no hold");

      const fetched = await this.provider.getHold(holdId);
      if (!fetched.ok) return err({ message: fetched.error.message });
      const checked = checkHold(fetched.value, { owner: { planId, memberId }, amountMinor: approvedMinor, currency });
      if (!checked.ok) return ok(`a member's hold is not usable (${checked.reason})`);
    }
    return ok(null);
  }
}
