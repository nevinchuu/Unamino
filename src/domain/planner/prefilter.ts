import type { ConstraintSet } from "@/domain/constraints/schema";
import { isOfferExpired, type ActivityOffer, type FlightOffer, type HotelOffer, type Offer } from "@/domain/offers/schema";
import { isFreeToCancel } from "@/domain/booking/order";
import { checkOffer } from "./check-constraints";

export interface PrefilterLimits {
  /** Flights kept per route, date and party size. */
  readonly flightsPerSlot: number;
  /** Hotel rooms kept per stay and room size, so a single room is never crowded out by triples. */
  readonly hotelsPerSlot: number;
  /** Activities kept per day. */
  readonly activitiesPerDay: number;
}

export const DEFAULT_PREFILTER_LIMITS: PrefilterLimits = { flightsPerSlot: 5, hotelsPerSlot: 3, activitiesPerDay: 4 };

export interface PrefilterInput {
  readonly offers: readonly Offer[];
  readonly constraints: ConstraintSet;
  readonly now: Date;
  readonly limits?: PrefilterLimits;
}

export interface PrefilterResult {
  /** The offers the planner may choose from, in their original order. */
  readonly offers: readonly Offer[];
  readonly expiredCount: number;
  /** Offers that were valid but did not make the cut for their slot. */
  readonly prunedCount: number;
}

/** How many members this offer would let down if they took it. Fewer is better. */
function violationCount(offer: Offer, constraints: ConstraintSet): number {
  return Object.entries(constraints).filter(([memberId, memberConstraints]) => checkOffer(memberId, offer, memberConstraints).length > 0).length;
}

/** Compares price per guest exactly, with cross-multiplication instead of division. */
const comparePricePerGuest = (a: Offer, b: Offer): number => a.totalMinor * b.guests - b.totalMinor * a.guests;

const flightSlot = (offer: FlightOffer): string => {
  const outbound = offer.legs.find((leg) => leg.direction === "outbound") ?? offer.legs[0];
  const roundTrip = offer.legs.some((leg) => leg.direction === "inbound");
  return `flight:${outbound.origin}-${outbound.destination}:${outbound.departAt.slice(0, 10)}:${roundTrip}:${offer.guests}`;
};
const hotelSlot = (offer: HotelOffer): string => `hotel:${offer.city}:${offer.checkIn}:${offer.checkOut}:${offer.guests}`;
const activitySlot = (offer: ActivityOffer): string => `activity:${offer.city}:${offer.date}`;

function slotOf(offer: Offer): string {
  switch (offer.kind) {
    case "flight":
      return flightSlot(offer);
    case "hotel":
      return hotelSlot(offer);
    case "activity":
      return activitySlot(offer);
  }
}

/**
 * Activities are opt-in, so a member who skips a category is not let down by it being offered: they just do not
 * join. Instead of ranking by violations, keep variety: the cheapest of each category first, then the cheapest rest.
 */
function pickActivities(candidates: readonly ActivityOffer[], limit: number): readonly Offer[] {
  const byPrice = [...candidates].sort((a, b) => comparePricePerGuest(a, b) || a.id.localeCompare(b.id));
  const cheapestPerCategory = new Map<string, ActivityOffer>();
  for (const offer of byPrice) {
    const category = offer.category.toLowerCase();
    if (!cheapestPerCategory.has(category)) cheapestPerCategory.set(category, offer);
  }
  const firstPicks = new Set(cheapestPerCategory.values());
  const ordered = [...firstPicks, ...byPrice.filter((offer) => !firstPicks.has(offer))];
  return ordered.slice(0, limit);
}

/** Flights and hotels: fewest unhappy members first, then price per guest, then id so the result never wobbles. */
function rank(candidates: readonly Offer[], constraints: ConstraintSet): readonly Offer[] {
  return candidates
    .map((offer) => ({ offer, violations: violationCount(offer, constraints) }))
    .sort((a, b) => a.violations - b.violations || comparePricePerGuest(a.offer, b.offer) || a.offer.id.localeCompare(b.offer.id))
    .map(({ offer }) => offer);
}

/**
 * The best few of a slot. A slot that has a hotel which can be cancelled for free always shows one, in place of the last
 * pick if need be, even when it costs more than the cheapest: whether the extra is worth it is for the group to decide,
 * and it cannot decide on a room it was never shown.
 */
function pickBest(candidates: readonly Offer[], limit: number, constraints: ConstraintSet, now: Date): readonly Offer[] {
  const ranked = rank(candidates, constraints);
  const chosen = ranked.slice(0, limit);
  if (limit < 2 || chosen.some((offer) => offer.kind === "hotel" && isFreeToCancel(offer, now))) return chosen;
  const refundable = ranked.find((offer) => offer.kind === "hotel" && isFreeToCancel(offer, now));
  return refundable ? [...chosen.slice(0, limit - 1), refundable] : chosen;
}

/**
 * Cuts a search down to what the planner needs to see: a search can return hundreds of flights, and the model
 * should not read them all. Expired offers go first. Then each slot (a route and date, a stay and room size, a
 * day of activities) keeps only its best few, ranked by who it would let down and then by price, so a pricier
 * flight that fits everyone's times is never dropped in favour of a cheap one that fits no-one.
 * Pure and deterministic: the same input always gives the same offers, in their original order.
 */
export function prefilterOffers(input: PrefilterInput): PrefilterResult {
  const { offers, constraints, now } = input;
  const limits = input.limits ?? DEFAULT_PREFILTER_LIMITS;

  const live = offers.filter((offer) => !isOfferExpired(offer, now));
  const slots = new Map<string, Offer[]>();
  for (const offer of live) {
    const key = slotOf(offer);
    slots.set(key, [...(slots.get(key) ?? []), offer]);
  }

  const kept = new Set<Offer>();
  for (const candidates of slots.values()) {
    const [first] = candidates;
    const chosen =
      first.kind === "activity"
        ? pickActivities(candidates as ActivityOffer[], limits.activitiesPerDay)
        : pickBest(candidates, first.kind === "flight" ? limits.flightsPerSlot : limits.hotelsPerSlot, constraints, now);
    for (const offer of chosen) kept.add(offer);
  }

  return {
    offers: live.filter((offer) => kept.has(offer)),
    expiredCount: offers.length - live.length,
    prunedCount: live.length - kept.size,
  };
}
