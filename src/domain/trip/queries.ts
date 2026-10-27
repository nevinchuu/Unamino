import type { OfferQuery } from "@/domain/offers/offer-source";
import type { CompleteTrip } from "./brief";

/** The biggest room that is worth asking for. Larger groups split across rooms of up to this size. */
export const MAX_ROOM_SIZE = 4;

/**
 * The searches that a complete trip needs: one round-trip flight search for the whole group, and a hotel
 * search for each room size, because a plan can mix rooms (three share, one has their own).
 * Activities are not searched: no source provides them yet.
 */
export function tripToQueries(trip: CompleteTrip, headcount: number): readonly OfferQuery[] {
  if (!Number.isInteger(headcount) || headcount < 1) return [];

  const flight: OfferQuery = {
    kind: "flight",
    city: trip.destinationCity,
    origin: trip.originAirport,
    destination: trip.destinationAirport,
    departDate: trip.departDate,
    returnDate: trip.returnDate,
    guests: headcount,
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
  return [flight, ...hotels];
}
