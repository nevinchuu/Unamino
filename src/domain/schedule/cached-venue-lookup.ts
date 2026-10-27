import type { Result } from "@/lib/result";
import type { VenueFacts, VenueLookup, VenueLookupError, VenueQuery } from "./venue";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  readonly venues: readonly VenueFacts[];
  readonly expiresAt: number;
}

const keyOf = ({ name, city }: VenueQuery): string => `${name.trim().toLowerCase()}|${city.trim().toLowerCase()}`;

/**
 * Remembers lookups so the same place is not paid for twice. Opening hours change rarely, so a day is plenty.
 * Failures are not cached: the next call tries again.
 */
export class CachedVenueLookup implements VenueLookup {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly inner: VenueLookup,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async search(query: VenueQuery): Promise<Result<readonly VenueFacts[], VenueLookupError>> {
    const key = keyOf(query);
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.clock()) return { ok: true, value: cached.venues };

    const result = await this.inner.search(query);
    if (result.ok) this.entries.set(key, { venues: result.value, expiresAt: this.clock() + this.ttlMs });
    return result;
  }
}
