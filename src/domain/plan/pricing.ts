import { err, type Result } from "@/lib/result";
import type { Offer } from "@/domain/offers/schema";
import { toLineItem } from "@/domain/planner/line-items";
import { applyCovers } from "@/domain/split/covers";
import { computeMemberShares } from "@/domain/split/shares";
import type { MemberShare, SplitError } from "@/domain/split/types";
import type { PlanDetails } from "./details-store";

export interface PricedPick {
  readonly offer: Offer;
  readonly memberIds: readonly string[];
}

/**
 * What each member's card pays for these picks at their current prices, in the member's own currency: their own part
 * of every pick, then any covers moved between friends. The trip total is the same with or without covers.
 * Offers must be in the plan's base currency: the split converts from there, and a pick in another
 * currency would be counted as if it were base-currency money.
 */
export function currentShares(details: Pick<PlanDetails, "baseCurrency" | "fx" | "members" | "covers">, picks: readonly PricedPick[]): Result<readonly MemberShare[], SplitError> {
  const foreign = picks.find(({ offer }) => offer.currency !== details.baseCurrency);
  if (foreign) {
    return err({ code: "invalid_currency", message: `${foreign.offer.title} is priced in ${foreign.offer.currency}, not ${details.baseCurrency}` });
  }
  const shares = computeMemberShares({
    lineItems: picks.map(({ offer, memberIds }) => toLineItem(offer, memberIds)),
    members: details.members,
    fx: details.fx,
  });
  return shares.ok ? applyCovers(shares.value, details.covers, details.fx) : shares;
}
