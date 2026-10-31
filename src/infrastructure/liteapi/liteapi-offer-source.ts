import { err, ok, type Result } from "@/lib/result";
import type { OfferQuery, OfferSource, OfferSourceError } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import { buildFlightRequest, flightRatesResponseSchema, mapFlightOffers } from "./flights";
import { buildHotelRequest, hotelRatesResponseSchema, mapHotelOffers } from "./hotels";
import { LiteApiHttp, readEnvelopeError, type LiteApiHttpOptions } from "./http";

const DEFAULT_HOTEL_LIMIT = 30;
const DEFAULT_HOTEL_OFFER_TTL_MINUTES = 10;

export interface LiteApiOfferSourceConfig extends LiteApiHttpOptions {
  /** The currency prices are quoted in, normally the plan's base currency. */
  readonly currency: string;
  /** Two-letter country code of the guests, which affects hotel rates. */
  readonly guestNationality: string;
  readonly hotelLimit?: number;
  readonly hotelOfferTtlMinutes?: number;
  readonly clock?: () => Date;
}

const invalidResponse = (what: string): OfferSourceError => ({
  code: "invalid_response",
  message: `liteAPI ${what} response did not match the expected shape`,
});

/** Finds hotels and flights through liteAPI. It does not offer activities. */
export class LiteApiOfferSource implements OfferSource {
  private readonly http: LiteApiHttp;
  private readonly clock: () => Date;

  constructor(private readonly config: LiteApiOfferSourceConfig) {
    this.http = new LiteApiHttp(config);
    this.clock = config.clock ?? (() => new Date());
  }

  async search(query: OfferQuery): Promise<Result<readonly Offer[], OfferSourceError>> {
    switch (query.kind) {
      case "hotel":
        return this.searchHotels(query);
      case "flight":
        return this.searchFlights(query);
      case "activity":
        return err({ code: "invalid_query", message: "liteAPI does not offer activities" });
    }
  }

  /**
   * Each hotel is asked for twice, once for its cheapest rate and once for its cheapest rate that can be cancelled for free,
   * because the two are often different rooms at different prices and the group should be able to choose. A hotel whose
   * cheapest rate is already refundable comes back in both and is kept once. If only the refundable search fails, the
   * cheapest rates still stand.
   */
  private async searchHotels(query: Extract<OfferQuery, { kind: "hotel" }>): Promise<Result<readonly Offer[], OfferSourceError>> {
    const [cheapest, refundable] = await Promise.all([this.hotelRates(query, false), this.hotelRates(query, true)]);
    if (!cheapest.ok) return cheapest;
    const byId = new Map<string, Offer>(cheapest.value.map((offer) => [offer.id, offer]));
    if (refundable.ok) for (const offer of refundable.value) byId.set(offer.id, offer);
    return ok([...byId.values()]);
  }

  private async hotelRates(query: Extract<OfferQuery, { kind: "hotel" }>, refundableOnly: boolean): Promise<Result<readonly Offer[], OfferSourceError>> {
    const body = buildHotelRequest(query, {
      currency: this.config.currency,
      guestNationality: this.config.guestNationality,
      limit: this.config.hotelLimit ?? DEFAULT_HOTEL_LIMIT,
      refundableOnly,
    });
    const raw = await this.http.post("/hotels/rates", body);
    if (!raw.ok) return raw;
    const envelope = readEnvelopeError(raw.value);
    if (!envelope.ok) return envelope;
    if (envelope.value === "no_availability") return ok([]);

    const parsed = hotelRatesResponseSchema.safeParse(raw.value);
    if (!parsed.success) return err(invalidResponse("hotel"));
    return ok(
      mapHotelOffers(parsed.data, query, {
        now: this.clock(),
        offerTtlMinutes: this.config.hotelOfferTtlMinutes ?? DEFAULT_HOTEL_OFFER_TTL_MINUTES,
      }),
    );
  }

  private async searchFlights(query: Extract<OfferQuery, { kind: "flight" }>): Promise<Result<readonly Offer[], OfferSourceError>> {
    const raw = await this.http.post("/flights/rates", buildFlightRequest(query, { currency: this.config.currency }));
    if (!raw.ok) return raw;
    const envelope = readEnvelopeError(raw.value);
    if (!envelope.ok) return envelope;
    if (envelope.value === "no_availability") return ok([]);

    const parsed = flightRatesResponseSchema.safeParse(raw.value);
    return parsed.success ? ok(mapFlightOffers(parsed.data, query)) : err(invalidResponse("flight"));
  }
}
