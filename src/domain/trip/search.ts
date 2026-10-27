import { err, ok, type Result } from "@/lib/result";
import type { OfferQuery, OfferSource, OfferSourceError } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import type { CompleteTrip } from "./brief";
import { tripToQueries } from "./queries";

/** One search and what it found, kept so the same query can be run again to renew the offers. */
export interface SearchRecord {
  readonly query: OfferQuery;
  readonly offers: readonly Offer[];
}

export interface SearchFailure {
  readonly query: OfferQuery;
  readonly error: OfferSourceError;
}

export interface TripSearchResult {
  readonly searches: readonly SearchRecord[];
  /** Searches that failed. The others still count: a plan may be possible without them. */
  readonly failures: readonly SearchFailure[];
  /** Every offer found, once each. */
  readonly offers: readonly Offer[];
}

/**
 * Runs every search a trip needs, all at once. A search that fails is reported and does not stop the rest,
 * because one hotel size failing should not hide the flights. Only when every search fails is that an error.
 */
export async function searchForTrip(source: OfferSource, trip: CompleteTrip, headcount: number): Promise<Result<TripSearchResult, OfferSourceError>> {
  const queries = tripToQueries(trip, headcount);
  if (queries.length === 0) return err({ code: "invalid_query", message: "A search needs at least one traveller" });

  const outcomes = await Promise.all(queries.map(async (query) => ({ query, result: await source.search(query) })));

  const searches: SearchRecord[] = [];
  const failures: SearchFailure[] = [];
  for (const { query, result } of outcomes) {
    if (result.ok) searches.push({ query, offers: result.value });
    else failures.push({ query, error: result.error });
  }
  if (searches.length === 0) return err(failures[0].error);

  const byId = new Map<string, Offer>();
  for (const { offers } of searches) for (const offer of offers) byId.set(offer.id, offer);
  return ok({ searches, failures, offers: [...byId.values()] });
}
