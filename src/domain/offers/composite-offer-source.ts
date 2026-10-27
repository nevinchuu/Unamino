import { err, type Result } from "@/lib/result";
import type { Offer, OfferKind } from "./schema";
import type { OfferQuery, OfferSource, OfferSourceError } from "./offer-source";

/** Sends each query to the source that handles its kind, e.g. hotels and flights to liteAPI, activities elsewhere. */
export class CompositeOfferSource implements OfferSource {
  constructor(private readonly sources: Readonly<Record<OfferKind, OfferSource>>) {}

  search(query: OfferQuery): Promise<Result<readonly Offer[], OfferSourceError>> {
    const source = this.sources[query.kind];
    return source
      ? source.search(query)
      : Promise.resolve(err({ code: "invalid_query", message: `No offer source for ${query.kind}` }));
  }
}
