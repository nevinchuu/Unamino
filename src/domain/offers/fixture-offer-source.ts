import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import type { OfferQuery, OfferSource, OfferSourceError } from "./offer-source";
import { fixtureOfferSchema, type FixtureOffer, type Offer } from "./schema";

const MS_PER_MINUTE = 60_000;

/** Checks raw fixture data against the schema, so a typo in the data file fails loudly and early. */
export function parseFixtureOffers(raw: unknown): Result<readonly FixtureOffer[], OfferSourceError> {
  const parsed = z.array(fixtureOfferSchema).safeParse(raw);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "invalid_response", message: z.prettifyError(parsed.error) });
}

const datePart = (dateTime: string): string => dateTime.slice(0, "YYYY-MM-DD".length);

function matches(offer: FixtureOffer, query: OfferQuery): boolean {
  if (offer.kind !== query.kind || offer.guests !== query.guests) return false;
  switch (offer.kind) {
    case "hotel":
      return query.kind === "hotel" && offer.city === query.city && offer.checkIn === query.checkIn && offer.checkOut === query.checkOut;
    case "activity":
      return query.kind === "activity" && offer.city === query.city && offer.date === query.date;
    case "flight": {
      if (query.kind !== "flight") return false;
      const [outbound, ...later] = offer.legs;
      const inbound = later.at(-1);
      const outboundMatches =
        outbound.origin === query.origin &&
        outbound.destination === query.destination &&
        datePart(outbound.departAt) === query.departDate;
      // A one-way query only matches one-way offers, and a round-trip query only round trips.
      const returnMatches = inbound
        ? inbound.origin === query.destination && datePart(inbound.departAt) === query.returnDate
        : query.returnDate === undefined;
      return outboundMatches && returnMatches;
    }
  }
}

/**
 * An offer source backed by fixed data. Expiry is counted from the moment of each search,
 * the way a real source's offers are, so a fixture offer is never already stale.
 */
export class FixtureOfferSource implements OfferSource {
  constructor(
    private readonly fixtures: readonly FixtureOffer[],
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async search(query: OfferQuery): Promise<Result<readonly Offer[], OfferSourceError>> {
    const now = this.clock().getTime();
    const offers = this.fixtures.filter((fixture) => matches(fixture, query)).map((fixture): Offer => {
      const { expiresInMinutes, ...rest } = fixture;
      return { ...rest, expiresAt: new Date(now + expiresInMinutes * MS_PER_MINUTE).toISOString() };
    });
    return ok(offers);
  }
}
