import { validatePlan, type ValidatedPlan } from "@/domain/planner/validate";
import { BANGKOK_OFFERS, MEMBER_IDS, NOW, WIREFRAME_PLAN } from "@/domain/planner/test-support";
import { err, ok, type Result } from "@/lib/result";
import type { OpeningHours } from "./opening-hours";
import type { VenueFacts, VenueLookup, VenueLookupError, VenueQuery } from "./venue";

/** The Bangkok trip from the wireframe, validated. */
export function wireframePlan(): ValidatedPlan {
  const result = validatePlan(WIREFRAME_PLAN, { offers: BANGKOK_OFFERS, memberIds: MEMBER_IDS, requiredKinds: ["flight", "hotel"], now: NOW });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Open every day of the week from `fromHour` to `toHour`. */
export function openDaily(fromHour: number, toHour: number): OpeningHours {
  return {
    kind: "periods",
    intervals: Array.from({ length: 7 }, (_, day) => ({ openMinute: day * 1440 + fromHour * 60, closeMinute: day * 1440 + toHour * 60 })),
  };
}

export function venue(name: string, overrides: Partial<VenueFacts> = {}): VenueFacts {
  return {
    placeId: `place-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    address: "1 Test Road, Bangkok",
    mapsUrl: `https://maps.example/${encodeURIComponent(name)}`,
    businessStatus: "operational",
    hours: openDaily(10, 22),
    ...overrides,
  };
}

/** A lookup that knows a fixed list of places and records what it was asked. */
export class FakeVenueLookup implements VenueLookup {
  readonly queries: VenueQuery[] = [];

  constructor(
    private readonly venues: readonly VenueFacts[],
    private readonly failure?: VenueLookupError,
  ) {}

  async search(query: VenueQuery): Promise<Result<readonly VenueFacts[], VenueLookupError>> {
    this.queries.push(query);
    if (this.failure) return err(this.failure);
    const wanted = query.name.toLowerCase();
    // Like a real search, return the best few places even if they are not the one asked for.
    const exact = this.venues.filter((candidate) => candidate.name.toLowerCase().includes(wanted));
    return ok(exact.length > 0 ? exact : this.venues.slice(0, 1));
  }
}

/** The gaps the Bangkok wireframe trip leaves free: Saturday lunch and evening, and Sunday until the airport. */
export const BANGKOK_GAP_IDS = ["gap-2026-12-12-1230", "gap-2026-12-12-1730", "gap-2026-12-13-0800"] as const;
