import type { ConstraintSet, MemberConstraints } from "@/domain/constraints/schema";
import { cabinLabel, cabinRank, type CabinClass } from "@/domain/offers/cabin";
import { clockTime } from "@/domain/offers/local-time";
import type { FlightOffer, HotelOffer, Offer } from "@/domain/offers/schema";
import type { MemberShare } from "@/domain/split/types";
import { formatMinor } from "@/lib/format-money";
import type { ValidatedPlan } from "./validate";

export type ViolationKind = "departure_window" | "return_window" | "own_room" | "skipped_activity" | "budget_cap" | "cabin_class" | "free_cancellation" | "meal_unverified";

export interface ConstraintViolation {
  readonly memberId: string;
  readonly kind: ViolationKind;
  readonly offerId?: string;
  /** Plain words, safe to show the member and to feed back to the planner. */
  readonly message: string;
}

type TimeWindow = NonNullable<MemberConstraints["outboundDeparture"]>;

/** Inclusive at both ends. A window whose start is after its end runs overnight, e.g. 22:00 to 02:00. */
function isInWindow(time: string, { after, before }: TimeWindow): boolean {
  if (after !== undefined && before !== undefined && after > before) return time >= after || time <= before;
  return (after === undefined || time >= after) && (before === undefined || time <= before);
}

const describeWindow = ({ after, before }: TimeWindow): string => {
  if (after !== undefined && before !== undefined) return `between ${after} and ${before}`;
  return after !== undefined ? `after ${after}` : `before ${before}`;
};

function checkDeparture(
  memberId: string,
  flight: FlightOffer,
  direction: "outbound" | "inbound",
  window: TimeWindow | undefined,
): ConstraintViolation | null {
  if (window === undefined) return null;
  const leg = flight.legs.find((candidate) => candidate.direction === direction);
  const time = leg ? clockTime(leg.departAt) : null;
  if (time === null || isInWindow(time, window)) return null;
  return {
    memberId,
    kind: direction === "outbound" ? "departure_window" : "return_window",
    offerId: flight.id,
    message: `${memberId} wants the ${direction} flight ${describeWindow(window)}, but ${flight.title} leaves at ${time}`,
  };
}

/** A fare in a lower cabin than the member needs. A fare with no cabin recorded counts as economy. */
function checkCabin(memberId: string, flight: FlightOffer, needed: CabinClass | undefined): ConstraintViolation | null {
  const actual = flight.cabin ?? "ECONOMY";
  if (needed === undefined || cabinRank(actual) >= cabinRank(needed)) return null;
  return { memberId, kind: "cabin_class", offerId: flight.id, message: `${memberId} needs ${cabinLabel(needed)} class but ${flight.title} is ${cabinLabel(actual)}` };
}

const present = (found: readonly (ConstraintViolation | null)[]): ConstraintViolation[] => found.filter((violation): violation is ConstraintViolation => violation !== null);

function checkFreeCancellation(memberId: string, offer: FlightOffer | HotelOffer, constraints: MemberConstraints): ConstraintViolation | null {
  if (!constraints.freeCancellation) return null;
  const free = offer.kind === "flight" ? offer.refundable : offer.freeCancellationUntil !== undefined;
  return free ? null : { memberId, kind: "free_cancellation", offerId: offer.id, message: `${memberId} needs free cancellation but ${offer.title} cannot be cancelled for free` };
}

/** Where one offer breaks what one member asked for, ignoring budget, which depends on the whole plan. */
export function checkOffer(memberId: string, offer: Offer, constraints: MemberConstraints): ConstraintViolation[] {
  switch (offer.kind) {
    case "flight":
      return present([
        checkDeparture(memberId, offer, "outbound", constraints.outboundDeparture),
        checkDeparture(memberId, offer, "inbound", constraints.returnDeparture),
        checkCabin(memberId, offer, constraints.cabinClass),
        checkFreeCancellation(memberId, offer, constraints),
      ]);
    case "hotel":
      return present([
        constraints.ownRoom && offer.guests > 1 ? { memberId, kind: "own_room", offerId: offer.id, message: `${memberId} wants their own room but ${offer.title} (${offer.roomName}) is shared by ${offer.guests}` } : null,
        checkFreeCancellation(memberId, offer, constraints),
      ]);
    case "activity":
      return constraints.skipActivityCategories?.includes(offer.category.toLowerCase())
        ? [{ memberId, kind: "skipped_activity", offerId: offer.id, message: `${memberId} does not want ${offer.category} activities but is in ${offer.title}` }]
        : [];
  }
}

function checkBudget(memberId: string, constraints: MemberConstraints, share: MemberShare | undefined): ConstraintViolation | null {
  const cap = constraints.budgetCap;
  if (cap === undefined || share === undefined) return null;
  if (cap.currency !== share.currency) {
    return { memberId, kind: "budget_cap", message: `${memberId}'s budget is in ${cap.currency} but they pay in ${share.currency}` };
  }
  return share.shareMinor > cap.amountMinor
    ? { memberId, kind: "budget_cap", message: `${memberId}'s share is ${formatMinor(share.shareMinor, share.currency)}, over their ${formatMinor(cap.amountMinor, cap.currency)} budget` }
    : null;
}

/**
 * A meal need cannot be checked: neither the flight nor the hotel data says anything about meals. It only counts as met
 * when the member said they will confirm it themselves, so the plan never promises something nobody can verify.
 */
function checkMeal(memberId: string, constraints: MemberConstraints, booksAnything: boolean): ConstraintViolation | null {
  if (!booksAnything || constraints.mealRequirement === undefined || constraints.mealSelfConfirmed === true) return null;
  return { memberId, kind: "meal_unverified", message: `${memberId} needs ${constraints.mealRequirement} meals, which cannot be checked from the flight or hotel data` };
}

/**
 * Lists where a valid plan breaks what members asked for. The planner's pick is checked here, not trusted:
 * a plan may still be the best available, and the violations tell members who is not fully served.
 */
export function findConstraintViolations(input: {
  readonly plan: ValidatedPlan;
  readonly constraints: ConstraintSet;
  readonly shares: readonly MemberShare[];
}): readonly ConstraintViolation[] {
  const { plan, constraints, shares } = input;
  const violations: ConstraintViolation[] = [];
  for (const [memberId, memberConstraints] of Object.entries(constraints)) {
    for (const pick of plan.picks.filter((candidate) => candidate.memberIds.includes(memberId))) {
      violations.push(...checkOffer(memberId, pick.offer, memberConstraints));
    }
    const budget = checkBudget(memberId, memberConstraints, shares.find((share) => share.memberId === memberId));
    if (budget) violations.push(budget);
    const meal = checkMeal(memberId, memberConstraints, plan.picks.some((pick) => pick.memberIds.includes(memberId) && pick.offer.kind !== "activity"));
    if (meal) violations.push(meal);
  }
  return violations;
}
