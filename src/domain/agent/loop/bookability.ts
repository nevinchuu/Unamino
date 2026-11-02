import type { Result } from "@/lib/result";
import type { SupplierError } from "@/domain/booking/ports";
import type { HotelOffer, Offer } from "@/domain/offers/schema";

/** Asks the hotel, without booking, whether a room can still be booked at its offer's price. */
export interface HotelBookability {
  checkBookable(offer: HotelOffer): Promise<Result<void, SupplierError>>;
}

/**
 * The hotel rooms in a plan that the hotel says cannot be booked at their price, checked all at once. A hotel that
 * could not be reached is not counted against its room: the check is tried again when the trip is booked, and a
 * plan should not be refused because a supplier was slow for a moment.
 */
export async function unbookableHotels(check: HotelBookability, offers: readonly Offer[]): Promise<readonly HotelOffer[]> {
  const hotels = offers.filter((offer): offer is HotelOffer => offer.kind === "hotel");
  const unique = [...new Map(hotels.map((offer) => [offer.id, offer])).values()];
  const answers = await Promise.all(unique.map(async (offer) => ({ offer, answer: await check.checkBookable(offer).catch(() => null) })));
  return answers.filter(({ answer }) => answer !== null && !answer.ok && answer.error.code !== "temporary").map(({ offer }) => offer);
}
