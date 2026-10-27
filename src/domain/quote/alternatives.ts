import type { ConstraintSet } from "@/domain/constraints/schema";
import { isOfferExpired, type Offer } from "@/domain/offers/schema";
import type { BuiltPlan } from "@/domain/planner/build-plan";
import { findConstraintViolations, type ConstraintViolation } from "@/domain/planner/check-constraints";
import { toLineItems } from "@/domain/planner/line-items";
import type { ValidatedPick, ValidatedPlan } from "@/domain/planner/validate";
import { computeMemberShares } from "@/domain/split/shares";
import type { FxRateTable, MemberInput, MemberShare } from "@/domain/split/types";
import { describeOffer } from "./describe";
import type { Alternative, SlotAlternatives } from "./types";

const DEFAULT_MAX_PER_SLOT = 3;

export interface AlternativesInput {
  readonly built: BuiltPlan;
  readonly members: readonly MemberInput[];
  readonly constraints: ConstraintSet;
  readonly fx: FxRateTable;
  /** Everything the search returned, not only what was picked. */
  readonly searched: readonly Offer[];
  readonly now: Date;
  readonly maxPerSlot?: number;
}

/** Violations are compared by who and what, because the offer id differs between the pick and its alternative. */
const violationKey = (violation: ConstraintViolation): string => `${violation.memberId}:${violation.kind}`;

const flightRoute = (offer: Extract<Offer, { kind: "flight" }>): string => {
  const first = offer.legs[0];
  return `${first.origin}-${first.destination}:${first.departAt.slice(0, 10)}:${offer.legs.some((leg) => leg.direction === "inbound")}`;
};

/** Can this offer take the picked one's place? Same kind, group size, currency and, for flights and hotels, the same trip. */
function isInSameSlot(picked: Offer, candidate: Offer): boolean {
  if (candidate.kind !== picked.kind || candidate.guests !== picked.guests || candidate.currency !== picked.currency) return false;
  if (picked.kind === "hotel" && candidate.kind === "hotel") {
    return picked.checkIn === candidate.checkIn && picked.checkOut === candidate.checkOut;
  }
  if (picked.kind === "flight" && candidate.kind === "flight") return flightRoute(picked) === flightRoute(candidate);
  return false;
}

function memberDiffs(
  slot: ValidatedPick,
  candidate: Offer,
  chosen: readonly MemberShare[],
  swapped: readonly MemberShare[],
): Record<string, number> {
  const diffs: Record<string, number> = {};
  const lineOf = (shares: readonly MemberShare[], memberId: string, itemId: string): number | undefined =>
    shares.find((share) => share.memberId === memberId)?.lines.find((line) => line.itemId === itemId)?.baseMinor;
  for (const memberId of slot.memberIds) {
    const before = lineOf(chosen, memberId, slot.offer.id);
    const after = lineOf(swapped, memberId, candidate.id);
    if (before !== undefined && after !== undefined) diffs[memberId] = after - before;
  }
  return diffs;
}

function evaluate(input: AlternativesInput, slot: ValidatedPick, candidate: Offer): Alternative {
  const { built, members, constraints, fx } = input;
  const swappedPlan: ValidatedPlan = {
    ...built.plan,
    picks: built.plan.picks.map((pick) => (pick === slot ? { ...pick, offer: candidate } : pick)),
    totalMinor: built.plan.totalMinor - slot.offer.totalMinor + candidate.totalMinor,
  };
  const split = computeMemberShares({ lineItems: toLineItems(swappedPlan), members, fx });
  // If pricing the swap somehow fails, budget reasons are skipped rather than guessed.
  const swappedShares = split.ok ? split.value : [];
  const violations = findConstraintViolations({ plan: swappedPlan, constraints, shares: swappedShares });

  const chosenKeys = new Set(built.violations.map(violationKey));
  const swappedKeys = new Set(violations.map(violationKey));
  const breaks = violations.filter((violation) => !chosenKeys.has(violationKey(violation)));
  return {
    offerId: candidate.id,
    listingId: candidate.listingId,
    title: candidate.title,
    detail: describeOffer(candidate),
    currency: candidate.currency,
    totalMinor: candidate.totalMinor,
    priceDiffMinor: candidate.totalMinor - slot.offer.totalMinor,
    memberDiffMinor: memberDiffs(slot, candidate, built.shares, swappedShares),
    status: breaks.length > 0 ? "ruled_out" : "viable",
    breaks,
    fixes: built.violations.filter((violation) => !swappedKeys.has(violationKey(violation))),
    expiresAt: candidate.expiresAt,
  };
}

/** Viable options come first (cheapest first), then the ones that were ruled out (cheapest first). */
const byUsefulness = (a: Alternative, b: Alternative): number =>
  Number(a.status === "ruled_out") - Number(b.status === "ruled_out") || a.totalMinor - b.totalMinor;

/**
 * For each flight and hotel in the plan, finds other searched offers that could take its place and says
 * whether each would suit the group. Activities are optional extras, not alternatives to one another.
 */
export function findAlternatives(input: AlternativesInput): readonly SlotAlternatives[] {
  const { built, searched, now } = input;
  const maxPerSlot = input.maxPerSlot ?? DEFAULT_MAX_PER_SLOT;
  const pickedIds = new Set(built.plan.picks.map((pick) => pick.offer.id));

  return built.plan.picks
    .filter((slot) => slot.offer.kind === "flight" || slot.offer.kind === "hotel")
    .map((slot) => ({
      pickedOfferId: slot.offer.id,
      alternatives: searched
        .filter(
          (candidate) =>
            !pickedIds.has(candidate.id) &&
            candidate.listingId !== slot.offer.listingId &&
            !isOfferExpired(candidate, now) &&
            isInSameSlot(slot.offer, candidate),
        )
        .map((candidate) => evaluate(input, slot, candidate))
        .sort(byUsefulness)
        .slice(0, maxPerSlot),
    }));
}
