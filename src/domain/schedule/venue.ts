import type { Result } from "@/lib/result";
import type { OpeningHours } from "./opening-hours";

export type BusinessStatus = "operational" | "closed_temporarily" | "closed_permanently" | "other";

/** What a lookup found out about a real place. Everything shown to users about a venue comes from here. */
export interface VenueFacts {
  readonly placeId: string;
  readonly name: string;
  readonly address: string | null;
  readonly mapsUrl: string | null;
  readonly businessStatus: BusinessStatus;
  /** Null when the source does not list opening hours. */
  readonly hours: OpeningHours | null;
}

export interface VenueQuery {
  readonly name: string;
  readonly city: string;
}

export type VenueLookupErrorCode = "lookup_unavailable" | "invalid_response";

export interface VenueLookupError {
  readonly code: VenueLookupErrorCode;
  readonly message: string;
}

/** Finds real places by name. Google Places in production; tests use a fake. */
export interface VenueLookup {
  /** Best matches first. An empty list means nothing was found. */
  search(query: VenueQuery): Promise<Result<readonly VenueFacts[], VenueLookupError>>;
}

const MIN_COMPACT_LENGTH = 4;
const MIN_TOKEN_OVERLAP = 0.75;

const normalise = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Is the place that was found the place that was asked for? Lenient about extra words and spacing
 * ("Thip Samai" matches "Thipsamai Pad Thai") but not about a different name altogether.
 */
export function namesMatch(proposed: string, found: string): boolean {
  const a = normalise(proposed);
  const b = normalise(found);
  if (a === "" || b === "") return false;
  if (a === b) return true;

  const compactA = a.replace(/ /g, "");
  const compactB = b.replace(/ /g, "");
  const shorter = compactA.length <= compactB.length ? compactA : compactB;
  const longer = compactA.length <= compactB.length ? compactB : compactA;
  if (shorter.length >= MIN_COMPACT_LENGTH && longer.includes(shorter)) return true;

  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  const shared = [...tokensA].filter((token) => tokensB.has(token)).length;
  return shared / Math.min(tokensA.size, tokensB.size) >= MIN_TOKEN_OVERLAP;
}
