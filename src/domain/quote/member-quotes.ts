import type { ConstraintSet } from "@/domain/constraints/schema";
import type { ValidatedPick } from "@/domain/planner/validate";
import type { MemberShare } from "@/domain/split/types";
import { describeOffer } from "./describe";
import type { MemberQuote, OfferQuote } from "./types";

/** What each covered member pays for one pick, read from the shares so the two never disagree. */
function perMemberAmounts(pick: ValidatedPick, shares: readonly MemberShare[]): Record<string, number> {
  const amounts: Record<string, number> = {};
  for (const memberId of pick.memberIds) {
    const line = shares.find((share) => share.memberId === memberId)?.lines.find((candidate) => candidate.itemId === pick.offer.id);
    if (line) amounts[memberId] = line.baseMinor;
  }
  return amounts;
}

function cancellationOf(pick: ValidatedPick): Pick<OfferQuote, "refundable" | "freeCancellationUntil"> {
  const { offer } = pick;
  switch (offer.kind) {
    case "flight":
      return { refundable: offer.refundable, freeCancellationUntil: null };
    case "hotel":
      return { refundable: offer.freeCancellationUntil !== undefined, freeCancellationUntil: offer.freeCancellationUntil ?? null };
    case "activity":
      return { refundable: null, freeCancellationUntil: null };
  }
}

export function buildOfferQuotes(picks: readonly ValidatedPick[], shares: readonly MemberShare[]): readonly OfferQuote[] {
  return picks.map((pick) => ({
    offerId: pick.offer.id,
    listingId: pick.offer.listingId,
    kind: pick.offer.kind,
    title: pick.offer.title,
    detail: describeOffer(pick.offer),
    currency: pick.offer.currency,
    totalMinor: pick.offer.totalMinor,
    memberIds: pick.memberIds,
    perMemberMinor: perMemberAmounts(pick, shares),
    ...cancellationOf(pick),
    expiresAt: pick.offer.expiresAt,
    excludedCharges: pick.offer.kind === "hotel" ? (pick.offer.excludedCharges ?? []) : [],
  }));
}

export function buildMemberQuotes(shares: readonly MemberShare[], constraints: ConstraintSet): readonly MemberQuote[] {
  return shares.map((share) => {
    const cap = constraints[share.memberId]?.budgetCap;
    return {
      memberId: share.memberId,
      currency: share.currency,
      lines: share.lines,
      baseShareMinor: share.baseShareMinor,
      shareMinor: share.shareMinor,
      fxRate: share.fxRate,
      fxSource: share.fxSource,
      budget: cap && cap.currency === share.currency ? { capMinor: cap.amountMinor, headroomMinor: cap.amountMinor - share.shareMinor } : null,
    };
  });
}
