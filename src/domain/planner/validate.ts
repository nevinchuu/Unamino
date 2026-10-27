import { err, ok, type Result } from "@/lib/result";
import { isOfferExpired, type FlightOffer, type HotelOffer, type Offer, type OfferKind } from "@/domain/offers/schema";
import type { PlanValidationError } from "./errors";
import { findOverlappingPair, type Interval } from "./overlap";
import type { PlannerOutput } from "./schema";

export interface PlanContext {
  /** Every offer the planner was allowed to choose from. */
  readonly offers: readonly Offer[];
  readonly memberIds: readonly string[];
  /** Kinds every member must have at least one of, e.g. a flight and a stay. */
  readonly requiredKinds: readonly OfferKind[];
  /** Who needs a flight, when that is fewer than everyone (someone already at the destination). Everyone still needs a room. */
  readonly flyingMemberIds?: readonly string[];
  readonly now: Date;
}

/** One offer, who it is for, and the planner's reasons. */
export interface ValidatedPick {
  readonly offer: Offer;
  readonly memberIds: readonly string[];
  readonly reason: string;
  readonly notes: Readonly<Record<string, string>>;
}

export interface ValidatedPlan {
  readonly title: string;
  readonly summary: string | undefined;
  readonly picks: readonly ValidatedPick[];
  readonly compromises: readonly { readonly memberId: string; readonly note: string }[];
  /** Sum of the picked offers, in minor units of `currency`. */
  readonly totalMinor: number;
  readonly currency: string;
}

type PlanCheck = (picks: readonly ValidatedPick[], context: PlanContext) => PlanValidationError | null;

const idsOf = (offers: readonly Offer[]): readonly string[] => offers.map((offer) => offer.id);

/**
 * Dates without an offset are read as UTC so results do not depend on the server's time zone.
 * Local flight times at different airports are off by their time difference, which is fine for
 * spotting two flights that clash.
 */
const instantOf = (dateTime: string): number => new Date(/(Z|[+-]\d{2}:\d{2})$/.test(dateTime) ? dateTime : `${dateTime}Z`).getTime();

function resolvePicks(
  output: PlannerOutput,
  context: PlanContext,
): Result<readonly ValidatedPick[], PlanValidationError> {
  const requestedIds = output.picks.map((pick) => pick.offerId);
  const duplicates = requestedIds.filter((id, index) => requestedIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    return err({ code: "duplicate_pick", message: "The same offer was picked twice", offerIds: duplicates });
  }
  const offersById = new Map(context.offers.map((offer) => [offer.id, offer]));
  const unknownIds = requestedIds.filter((id) => !offersById.has(id));
  if (unknownIds.length > 0) {
    return err({ code: "unknown_offer", message: "Some picked offers do not exist", offerIds: unknownIds });
  }

  const knownMembers = new Set(context.memberIds);
  const picks: ValidatedPick[] = [];
  for (const pick of output.picks) {
    const offer = offersById.get(pick.offerId) as Offer; // every id was checked above
    const memberIds = pick.members.map((member) => member.memberId);

    const unknownMembers = memberIds.filter((id) => !knownMembers.has(id));
    if (unknownMembers.length > 0) {
      return err({ code: "unknown_member", message: `${offer.title}: unknown members ${unknownMembers.join(", ")}`, offerIds: [offer.id], memberIds: unknownMembers });
    }
    if (new Set(memberIds).size !== memberIds.length) {
      return err({ code: "duplicate_member", message: `${offer.title}: a member is listed twice`, offerIds: [offer.id] });
    }
    if (memberIds.length !== offer.guests) {
      return err({
        code: "guests_mismatch",
        message: `${offer.title} is priced for ${offer.guests} guest(s) but ${memberIds.length} member(s) were assigned`,
        offerIds: [offer.id],
      });
    }
    picks.push({
      offer,
      memberIds,
      reason: pick.reason,
      notes: Object.fromEntries(pick.members.map((member) => [member.memberId, member.note])),
    });
  }

  const unknownCompromise = (output.compromises ?? []).filter((item) => !knownMembers.has(item.memberId));
  if (unknownCompromise.length > 0) {
    return err({ code: "unknown_member", message: "A compromise names an unknown member", memberIds: unknownCompromise.map((item) => item.memberId) });
  }
  return ok(picks);
}

const checkNotExpired: PlanCheck = (picks, { now }) => {
  const expired = picks.map((pick) => pick.offer).filter((offer) => isOfferExpired(offer, now));
  return expired.length === 0
    ? null
    : { code: "expired_offer", message: "Some picked offers have expired", offerIds: idsOf(expired) };
};

const checkSingleCurrency: PlanCheck = (picks) =>
  new Set(picks.map((pick) => pick.offer.currency)).size <= 1
    ? null
    : { code: "mixed_currency", message: "Picked offers use more than one currency", offerIds: idsOf(picks.map((pick) => pick.offer)) };

const hotelIntervals = (picks: readonly ValidatedPick[]): readonly Interval<string>[] =>
  picks
    .map((pick) => pick.offer)
    .filter((offer): offer is HotelOffer => offer.kind === "hotel")
    .map((hotel) => ({ start: instantOf(hotel.checkIn), end: instantOf(hotel.checkOut), owner: hotel.id }));

const flightIntervals = (picks: readonly ValidatedPick[]): readonly Interval<string>[] =>
  picks
    .map((pick) => pick.offer)
    .filter((offer): offer is FlightOffer => offer.kind === "flight")
    .flatMap((flight) => flight.legs.map((leg) => ({ start: instantOf(leg.departAt), end: instantOf(leg.arriveAt), owner: flight.id })));

/** The same person cannot be in two places at once; different people can share dates freely. */
const perMemberOverlapCheck =
  (code: "overlapping_hotels" | "overlapping_flights", what: string, toIntervals: (picks: readonly ValidatedPick[]) => readonly Interval<string>[]): PlanCheck =>
  (picks, { memberIds }) => {
    for (const memberId of memberIds) {
      const pair = findOverlappingPair(toIntervals(picks.filter((pick) => pick.memberIds.includes(memberId))));
      if (pair) return { code, message: `${memberId} has two ${what} that overlap`, offerIds: [pair[0].owner, pair[1].owner], memberIds: [memberId] };
    }
    return null;
  };

const checkHotelsDoNotOverlap = perMemberOverlapCheck("overlapping_hotels", "hotel stays", hotelIntervals);
const checkFlightsDoNotOverlap = perMemberOverlapCheck("overlapping_flights", "flights", flightIntervals);

const checkEveryoneCovered: PlanCheck = (picks, { memberIds, requiredKinds, flyingMemberIds }) => {
  for (const kind of requiredKinds) {
    const covered = new Set(picks.filter((pick) => pick.offer.kind === kind).flatMap((pick) => pick.memberIds));
    const needing = kind === "flight" && flyingMemberIds ? flyingMemberIds : memberIds;
    const missing = needing.filter((id) => !covered.has(id));
    if (missing.length > 0) {
      return { code: "member_not_covered", message: `No ${kind} for ${missing.join(", ")}`, memberIds: missing };
    }
  }
  return null;
};

/** Run in order; add a new rule by adding a check here. */
const PLAN_CHECKS: readonly PlanCheck[] = [
  checkNotExpired,
  checkSingleCurrency,
  checkHotelsDoNotOverlap,
  checkFlightsDoNotOverlap,
  checkEveryoneCovered,
];

/** Checks the planner's picks against the real offers and returns the priced plan, or what to fix. */
export function validatePlan(output: PlannerOutput, context: PlanContext): Result<ValidatedPlan, PlanValidationError> {
  const resolved = resolvePicks(output, context);
  if (!resolved.ok) return resolved;
  for (const check of PLAN_CHECKS) {
    const problem = check(resolved.value, context);
    if (problem) return err(problem);
  }
  return ok({
    title: output.title,
    summary: output.summary,
    picks: resolved.value,
    compromises: output.compromises ?? [],
    totalMinor: resolved.value.reduce((total, pick) => total + pick.offer.totalMinor, 0),
    currency: resolved.value[0].offer.currency,
  });
}
