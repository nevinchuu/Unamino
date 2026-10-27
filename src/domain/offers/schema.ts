import { z } from "zod";

export const OFFER_KINDS = ["hotel", "flight", "activity"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

const isoDate = z.iso.date();
/** An instant, e.g. an expiry. Always UTC. */
const instant = z.iso.datetime();
/** A wall-clock time at a place. Carries its offset when the source gives one, so flight times can be read as local. */
const localDateTime = z.iso.datetime({ offset: true, local: true });
const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Expected a 3-letter uppercase currency code");
const airportCode = z.string().regex(/^[A-Z]{3}$/, "Expected a 3-letter IATA airport code");
const positiveInteger = z.number().int().positive();

/**
 * Fields every offer shares. An offer is priced for a number of guests, not for the whole group:
 * `totalMinor` covers exactly `guests` people. Who those people are is decided later, by the plan.
 * `id` identifies this offer and changes whenever offers are fetched again.
 * `listingId` identifies the underlying hotel room, flight journey or activity and stays the same.
 */
const baseFields = {
  id: z.string().min(1),
  listingId: z.string().min(1),
  title: z.string().min(1),
  provider: z.string().min(1),
  city: z.string().min(1),
  currency: currencyCode,
  totalMinor: positiveInteger,
  guests: positiveInteger,
};

const hotelFields = {
  ...baseFields,
  kind: z.literal("hotel"),
  checkIn: isoDate,
  checkOut: isoDate,
  stars: z.number().int().min(1).max(5).optional(),
  roomName: z.string().min(1),
  freeCancellationUntil: instant.optional(),
};

const flightLegSchema = z.object({
  origin: airportCode,
  destination: airportCode,
  departAt: localDateTime,
  arriveAt: localDateTime,
  carrier: z.string().min(1),
});

const flightFields = {
  ...baseFields,
  kind: z.literal("flight"),
  legs: z.array(flightLegSchema).min(1),
  refundable: z.boolean(),
};

const activityFields = {
  ...baseFields,
  kind: z.literal("activity"),
  date: isoDate,
  durationMinutes: positiveInteger,
  /** Lowercase label such as "cooking" or "tour", used to match what a member wants to skip. */
  category: z.string().min(1),
};

/** The shape every offer source must return, real or fixture. */
export const offerSchema = z.discriminatedUnion("kind", [
  z.object({ ...hotelFields, expiresAt: instant }),
  z.object({ ...flightFields, expiresAt: instant }),
  z.object({ ...activityFields, expiresAt: instant }),
]);

/** The shape stored in the fixture file: expiry is relative so fixture offers never go stale. */
const relativeExpiry = { expiresInMinutes: positiveInteger };
export const fixtureOfferSchema = z.discriminatedUnion("kind", [
  z.object({ ...hotelFields, ...relativeExpiry }),
  z.object({ ...flightFields, ...relativeExpiry }),
  z.object({ ...activityFields, ...relativeExpiry }),
]);

export type Offer = z.infer<typeof offerSchema>;
export type FixtureOffer = z.infer<typeof fixtureOfferSchema>;
export type HotelOffer = Extract<Offer, { kind: "hotel" }>;
export type FlightOffer = Extract<Offer, { kind: "flight" }>;
export type ActivityOffer = Extract<Offer, { kind: "activity" }>;

export const isOfferExpired = (offer: Offer, now: Date): boolean => new Date(offer.expiresAt) <= now;
