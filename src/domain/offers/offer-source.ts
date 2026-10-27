import type { Result } from "@/lib/result";
import type { Offer } from "./schema";

interface QueryBase {
  /** How many people the offers must be priced for. */
  readonly guests: number;
}

export interface HotelQuery extends QueryBase {
  readonly kind: "hotel";
  readonly city: string;
  /** ISO 3166 two-letter country code of the city, which the hotel search needs. */
  readonly countryCode: string;
  readonly checkIn: string;
  readonly checkOut: string;
}

export interface FlightQuery extends QueryBase {
  readonly kind: "flight";
  /** The destination city's name, used to label the offers. */
  readonly city: string;
  readonly origin: string;
  readonly destination: string;
  readonly departDate: string;
  /** When present the offers are round trips. */
  readonly returnDate?: string;
}

export interface ActivityQuery extends QueryBase {
  readonly kind: "activity";
  readonly city: string;
  readonly date: string;
}

export type OfferQuery = HotelQuery | FlightQuery | ActivityQuery;

export type OfferSourceErrorCode = "source_unavailable" | "invalid_response" | "invalid_query";

export interface OfferSourceError {
  readonly code: OfferSourceErrorCode;
  readonly message: string;
}

/** Anything that can find offers: the liteAPI client in production, the fixture source in tests. */
export interface OfferSource {
  search(query: OfferQuery): Promise<Result<readonly Offer[], OfferSourceError>>;
}
