import { err, type Result } from "@/lib/result";
import type { Offer } from "@/domain/offers/schema";
import { toLineItem } from "@/domain/planner/line-items";
import { computeMemberShares } from "@/domain/split/shares";
import type { MemberShare, SplitError } from "@/domain/split/types";
import type { PlanDetails } from "./details-store";

export interface PricedPick {
  readonly offer: Offer;
  readonly memberIds: readonly string[];
}

/**
 * What each member owes for these picks at their current prices, in the member's own currency.
 * Offers must be in the plan's base currency: the split converts from there, and a pick in another
 * currency would be counted as if it were base-currency money.
 */
export function currentShares(details: Pick<PlanDetails, "baseCurrency" | "fx" | "members">, picks: readonly PricedPick[]): Result<readonly MemberShare[], SplitError> {
  const foreign = picks.find(({ offer }) => offer.currency !== details.baseCurrency);
  if (foreign) {
    return err({ code: "invalid_currency", message: `${foreign.offer.title} is priced in ${foreign.offer.currency}, not ${details.baseCurrency}` });
  }
  return computeMemberShares({
    lineItems: picks.map(({ offer, memberIds }) => toLineItem(offer, memberIds)),
    members: details.members,
    fx: details.fx,
  });
}
