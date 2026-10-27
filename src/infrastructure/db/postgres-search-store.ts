import { err, ok, type Result } from "@/lib/result";
import type { SearchStore, StoreError } from "@/domain/agent/ports";
import type { SearchRecord } from "@/domain/trip/search";
import type { Database } from "./client";
import { offerSearches, offers } from "./schema";

const OFFER_BATCH = 100;

/** Keeps every search and every offer it found, not only the ones a plan used, so alternatives and renewals can be worked out later. */
export class PostgresSearchStore implements SearchStore {
  constructor(private readonly db: Database) {}

  async save(briefId: string, searches: readonly SearchRecord[], fetchedAt: Date): Promise<Result<ReadonlyMap<string, string>, StoreError>> {
    try {
      return await this.db.transaction(async (tx) => {
        const searchIdByOffer = new Map<string, string>();
        for (const search of searches) {
          const [row] = await tx.insert(offerSearches).values({ briefId, kind: search.query.kind, query: search.query, guests: search.query.guests, fetchedAt }).returning({ id: offerSearches.id });
          const fresh = search.offers.filter((offer) => !searchIdByOffer.has(offer.id));
          for (const offer of fresh) searchIdByOffer.set(offer.id, row.id);

          for (let start = 0; start < fresh.length; start += OFFER_BATCH) {
            await tx.insert(offers).values(
              fresh.slice(start, start + OFFER_BATCH).map((offer) => ({ searchId: row.id, offerId: offer.id, listingId: offer.listingId, kind: offer.kind, offer, expiresAt: new Date(offer.expiresAt) })),
            );
          }
        }
        return ok(searchIdByOffer);
      });
    } catch {
      return err({ code: "unavailable", message: "The searches could not be saved" });
    }
  }
}
