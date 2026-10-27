import type { OfferQuery } from "@/domain/offers/offer-source";
import type { CompleteTrip } from "./brief";

/** The biggest room that is worth asking for. Larger groups split across rooms of up to this size. */
export const MAX_ROOM_SIZE = 4;

/**
 * The searches that a complete trip needs: one round-trip flight search for the people who fly (everyone unless
 * told otherwise), and a hotel search for each room size, because a plan can mix rooms (three share, one has their own).
 * Someone already at the destination needs a room but no flight, so `flyers` can be fewer than `headcount`, even none.
 * Activities are not searched: no source provides them yet.
 */
export function tripToQueries(trip: CompleteTrip, headcount: number, flyers: number = headcount): readonly OfferQuery[] {
  if (!Number.isInteger(headcount) || headcount < 1) return [];
  if (!Number.isInteger(flyers) || flyers < 0 || flyers > headcount) return [];

  const flight: OfferQuery = {
    kind: "flight",
    city: trip.destinationCity,
    origin: trip.originAirport,
    destination: trip.destinationAirport,
    departDate: trip.departDate,
    returnDate: trip.returnDate,
    guests: flyers,
  };

  const roomSizes = Array.from({ length: Math.min(headcount, MAX_ROOM_SIZE) }, (_, index) => index + 1);
  const hotels = roomSizes.map(
    (guests): OfferQuery => ({
      kind: "hotel",
      city: trip.destinationCity,
      countryCode: trip.destinationCountry,
      checkIn: trip.departDate,
      checkOut: trip.returnDate,
      guests,
    }),
  );
  return flyers > 0 ? [flight, ...hotels] : hotels;
}
