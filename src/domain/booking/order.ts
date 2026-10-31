import type { FlightOffer, HotelOffer, Offer } from "@/domain/offers/schema";

/** Anything that carries an offer, such as a stored pick or a pick of a plan being made. */
interface Part {
  readonly offer: Offer;
}

/** A part bought from a supplier. Activities are only suggestions and are never booked. */
type Bought<T extends Part> = T & { readonly offer: HotelOffer | FlightOffer };

const isBought = <T extends Part>(part: T): part is Bought<T> => part.offer.kind !== "activity";

/** Can this part still be cancelled for free at `now`? A hotel only until its free-cancellation time, a flight only if the fare is refundable. */
export function isFreeToCancel(offer: HotelOffer | FlightOffer, now: Date): boolean {
  return offer.kind === "flight" ? offer.refundable : offer.freeCancellationUntil !== undefined && new Date(offer.freeCancellationUntil) > now;
}

/**
 * The order to book a plan's parts in: whatever can be cancelled for free first, and what cannot last, so that if a later
 * booking fails everything already booked can be undone without anyone losing money. Among parts that can be undone
 * equally, hotels go before flights, because a hotel cancels at once while an airline may take its time. Parts the
 * plan does not buy (activities) are left out. The order is the same every time for the same plan.
 */
export function bookingOrder<T extends Part>(parts: readonly T[], now: Date): readonly Bought<T>[] {
  const rank = (part: Bought<T>): number => (isFreeToCancel(part.offer, now) ? 0 : 2) + (part.offer.kind === "hotel" ? 0 : 1);
  return parts
    .filter(isBought)
    .map((part, index) => ({ part, index }))
    .sort((a, b) => rank(a.part) - rank(b.part) || a.index - b.index)
    .map(({ part }) => part);
}

/**
 * The parts that would be lost if a booking made after them failed: every part that cannot be cancelled for free except
 * the one booked last. With one such part or none, a failure always leaves nobody out of pocket. In booking order.
 */
export function unprotectedParts<T extends Part>(parts: readonly T[], now: Date): readonly Bought<T>[] {
  const ordered = bookingOrder(parts, now);
  const final = ordered[ordered.length - 1];
  return ordered.filter((part) => part !== final && !isFreeToCancel(part.offer, now));
}
