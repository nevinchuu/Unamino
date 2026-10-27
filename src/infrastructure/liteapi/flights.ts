import { z } from "zod";
import { toMinorUnits } from "@/domain/money/currency";
import type { FlightQuery } from "@/domain/offers/offer-source";
import { offerSchema, type FlightOffer } from "@/domain/offers/schema";

const PROVIDER = "liteapi";

const segmentSchema = z.object({
  originCode: z.string(),
  destinationCode: z.string(),
  departureTime: z.string(),
  arrivalTime: z.string(),
  carrier: z.object({ marketingName: z.string() }),
  direction: z.enum(["OUTBOUND", "INBOUND"]),
});

const offerPriceSchema = z.object({
  offerId: z.string().min(1),
  expiration: z.string(),
  pricing: z.object({ display: z.object({ total: z.number(), currency: z.string() }) }),
  terms: z.object({ refundable: z.boolean().optional() }).optional(),
});

export const flightRatesResponseSchema = z.object({
  data: z.array(
    z.object({
      journeys: z.array(
        z.object({
          journeyKey: z.string().min(1),
          segments: z.array(segmentSchema).min(1),
          cheapestOffer: offerPriceSchema,
        }),
      ),
    }),
  ),
});

export interface FlightRequestOptions {
  readonly currency: string;
}

/** `adults` is the number of guests, so a returned price covers all of them. */
export function buildFlightRequest(query: FlightQuery, options: FlightRequestOptions): Record<string, unknown> {
  const legs: Record<string, string>[] = [
    { origin: query.origin, destination: query.destination, date: query.departDate, direction: "OUTBOUND" },
  ];
  if (query.returnDate) {
    legs.push({ origin: query.destination, destination: query.origin, date: query.returnDate, direction: "INBOUND" });
  }
  return { legs, adults: query.guests, currency: options.currency, cabinClass: "ECONOMY" };
}

/**
 * Turns a validated liteAPI flight response into offers, one per journey, using its cheapest fare.
 * `journeyKey` stays the same between searches (the listing) and `offerId` changes each time (the offer).
 * A journey that cannot be priced or mapped is left out.
 */
export function mapFlightOffers(
  response: z.infer<typeof flightRatesResponseSchema>,
  query: FlightQuery,
): readonly FlightOffer[] {
  const offers: FlightOffer[] = [];
  for (const { journeys } of response.data) {
    for (const journey of journeys) {
      const fare = journey.cheapestOffer;
      const totalMinor = toMinorUnits(fare.pricing.display.total, fare.pricing.display.currency);
      if (totalMinor === null) continue;
      const candidate = {
        kind: "flight",
        id: fare.offerId,
        listingId: journey.journeyKey,
        title: `${query.origin} to ${query.destination}`,
        provider: PROVIDER,
        city: query.city,
        currency: fare.pricing.display.currency,
        totalMinor,
        guests: query.guests,
        legs: journey.segments.map((segment) => ({
          origin: segment.originCode,
          destination: segment.destinationCode,
          departAt: segment.departureTime,
          arriveAt: segment.arrivalTime,
          carrier: segment.carrier.marketingName,
          direction: segment.direction === "OUTBOUND" ? ("outbound" as const) : ("inbound" as const),
        })),
        refundable: fare.terms?.refundable ?? false,
        expiresAt: fare.expiration,
      };
      const checked = offerSchema.safeParse(candidate);
      if (checked.success && checked.data.kind === "flight") offers.push(checked.data);
    }
  }
  return offers;
}
