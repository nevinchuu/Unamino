import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { toOpeningHours } from "@/domain/schedule/opening-hours";
import type { BusinessStatus, VenueFacts, VenueLookup, VenueLookupError, VenueQuery } from "@/domain/schedule/venue";

const DEFAULT_BASE_URL = "https://places.googleapis.com/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 3;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
/** Only what is needed. Opening hours put the call in the Enterprise price tier, which has a small free allowance. */
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.businessStatus,places.regularOpeningHours";

const pointSchema = z.object({ day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) });

const placeSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string() }),
  formattedAddress: z.string().optional(),
  googleMapsUri: z.string().optional(),
  businessStatus: z.string().optional(),
  regularOpeningHours: z.object({ periods: z.array(z.object({ open: pointSchema, close: pointSchema.optional() })).optional() }).optional(),
});

/** Google returns an empty object when nothing matches, so `places` may be missing. */
export const searchTextResponseSchema = z.object({ places: z.array(placeSchema).optional() });

export interface GooglePlacesConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxResults?: number;
  readonly fetchImpl?: typeof fetch;
}

const fail = (code: VenueLookupError["code"], message: string): Result<never, VenueLookupError> => err({ code, message });

const STATUSES: Readonly<Record<string, BusinessStatus>> = {
  OPERATIONAL: "operational",
  CLOSED_TEMPORARILY: "closed_temporarily",
  CLOSED_PERMANENTLY: "closed_permanently",
};

function toVenueFacts(place: z.infer<typeof placeSchema>): VenueFacts {
  const periods = place.regularOpeningHours?.periods;
  return {
    placeId: place.id,
    name: place.displayName.text,
    address: place.formattedAddress ?? null,
    mapsUrl: place.googleMapsUri ?? null,
    businessStatus: STATUSES[place.businessStatus ?? ""] ?? "other",
    // No periods field means Google lists no hours; an empty list would mean never open.
    hours: periods === undefined ? null : toOpeningHours(periods),
  };
}

/** Looks up places with the Google Places (New) Text Search. The key is sent in a header and never in an error message. */
export class GooglePlacesLookup implements VenueLookup {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GooglePlacesConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async search(query: VenueQuery): Promise<Result<readonly VenueFacts[], VenueLookupError>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/places:searchText`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": this.config.apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({ textQuery: `${query.name}, ${query.city}`, languageCode: "en", maxResultCount: this.config.maxResults ?? DEFAULT_MAX_RESULTS }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return fail("lookup_unavailable", "Google Places did not respond in time");
    }

    if (response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN) {
      return fail("lookup_unavailable", "Google Places rejected the API key");
    }
    if (response.status === HTTP_TOO_MANY_REQUESTS) return fail("lookup_unavailable", "Google Places is rate limiting requests");
    if (!response.ok) return fail("lookup_unavailable", `Google Places returned an error (${response.status})`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fail("invalid_response", "Google Places returned a response that is not JSON");
    }
    const parsed = searchTextResponseSchema.safeParse(body);
    return parsed.success
      ? ok((parsed.data.places ?? []).map(toVenueFacts))
      : fail("invalid_response", "Google Places response did not match the expected shape");
  }
}
