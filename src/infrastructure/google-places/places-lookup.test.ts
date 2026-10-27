import { describe, expect, it } from "vitest";
import { isOpenDuring } from "@/domain/schedule/opening-hours";
import { namesMatch } from "@/domain/schedule/venue";
import realResponses from "./fixtures/search-text-bangkok.json";
import { GooglePlacesLookup } from "./places-lookup";

const API_KEY = "AIza_test_key_that_must_never_leak";

interface RecordedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function lookupWith(respond: () => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) as Record<string, unknown> });
    return respond();
  }) as unknown as typeof fetch;
  return { lookup: new GooglePlacesLookup({ apiKey: API_KEY, fetchImpl }), calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const day = (d: number, open: [number, number], close: [number, number]) => ({
  open: { day: d, hour: open[0], minute: open[1] },
  close: { day: d, hour: close[0], minute: close[1] },
});

/** Shaped like the Google Places (New) documentation. The real responses are tested separately below. */
const thipSamai = {
  id: "ChIJ_thip_samai",
  displayName: { text: "Thip Samai Pad Thai", languageCode: "en" },
  formattedAddress: "313 Maha Chai Rd, Bangkok 10200, Thailand",
  googleMapsUri: "https://maps.google.com/?cid=123",
  businessStatus: "OPERATIONAL",
  regularOpeningHours: { periods: [0, 1, 2, 3, 4, 5, 6].map((d) => day(d, [17, 0], [23, 59])) },
};

describe("GooglePlacesLookup request", () => {
  it("sends the key and field mask in headers and the name with the city as the query", async () => {
    const { lookup, calls } = lookupWith(() => json({ places: [thipSamai] }));
    await lookup.search({ name: "Thip Samai", city: "Bangkok" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(calls[0].headers["X-Goog-Api-Key"]).toBe(API_KEY);
    expect(calls[0].headers["X-Goog-FieldMask"]).toContain("places.regularOpeningHours");
    expect(calls[0].headers["X-Goog-FieldMask"]).not.toContain("*");
    expect(JSON.stringify(calls[0].body)).not.toContain(API_KEY);
    expect(calls[0].body).toEqual({ textQuery: "Thip Samai, Bangkok", languageCode: "en", maxResultCount: 3 });
  });
});

describe("GooglePlacesLookup results", () => {
  it("maps a place to venue facts, with opening hours that can be checked by day and time", async () => {
    const { lookup } = lookupWith(() => json({ places: [thipSamai] }));
    const result = await lookup.search({ name: "Thip Samai", city: "Bangkok" });
    if (!result.ok) throw new Error(result.error.message);

    const [venue] = result.value;
    expect(venue).toMatchObject({
      placeId: "ChIJ_thip_samai", name: "Thip Samai Pad Thai", businessStatus: "operational",
      address: "313 Maha Chai Rd, Bangkok 10200, Thailand", mapsUrl: "https://maps.google.com/?cid=123",
    });
    expect(venue.hours && isOpenDuring(venue.hours, { date: "2026-12-12", startMinute: 18 * 60, endMinute: 19 * 60 })).toBe(true);
    expect(venue.hours && isOpenDuring(venue.hours, { date: "2026-12-12", startMinute: 12 * 60, endMinute: 13 * 60 })).toBe(false);
  });

  it("has no hours when Google lists none, and treats unknown statuses as other", async () => {
    const { lookup } = lookupWith(() => json({ places: [{ id: "p1", displayName: { text: "Mystery" }, businessStatus: "FUTURE_OPENING" }] }));
    const result = await lookup.search({ name: "Mystery", city: "Bangkok" });
    expect(result.ok && result.value[0]).toMatchObject({ hours: null, businessStatus: "other", address: null, mapsUrl: null });
  });

  it("recognises closed places", async () => {
    const { lookup } = lookupWith(() => json({ places: [{ ...thipSamai, businessStatus: "CLOSED_PERMANENTLY" }] }));
    const result = await lookup.search({ name: "Thip Samai", city: "Bangkok" });
    expect(result.ok && result.value[0].businessStatus).toBe("closed_permanently");
  });

  it("recognises a place that is always open", async () => {
    const always = { ...thipSamai, regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } };
    const { lookup } = lookupWith(() => json({ places: [always] }));
    const result = await lookup.search({ name: "Thip Samai", city: "Bangkok" });
    expect(result.ok && result.value[0].hours).toEqual({ kind: "always" });
  });

  it("returns an empty list when nothing matches, which Google signals with an empty object", async () => {
    const { lookup } = lookupWith(() => json({}));
    expect(await lookup.search({ name: "Nowhere", city: "Bangkok" })).toEqual({ ok: true, value: [] });
  });
});

describe("GooglePlacesLookup failures", () => {
  it.each([
    [401, "rejected the API key"],
    [403, "rejected the API key"],
    [429, "rate limiting"],
    [500, "returned an error (500)"],
    [400, "returned an error (400)"],
  ])("maps HTTP %i to an unavailable lookup", async (status, message) => {
    const { lookup } = lookupWith(() => json({ error: { message: "x" } }, status));
    const result = await lookup.search({ name: "Thip Samai", city: "Bangkok" });
    expect(result.ok ? null : result.error.code).toBe("lookup_unavailable");
    expect(!result.ok && result.error.message).toContain(message);
  });

  it("reports a network failure or timeout", async () => {
    const { lookup } = lookupWith(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    const result = await lookup.search({ name: "Thip Samai", city: "Bangkok" });
    expect(result.ok ? null : result.error.code).toBe("lookup_unavailable");
  });

  it("reports a body that is not JSON, or has the wrong shape", async () => {
    const notJson = lookupWith(() => new Response("<html>", { status: 200 }));
    expect((await notJson.lookup.search({ name: "x", city: "y" })).ok).toBe(false);
    const wrong = lookupWith(() => json({ places: [{ id: 7 }] }));
    const result = await wrong.lookup.search({ name: "x", city: "y" });
    expect(result.ok ? null : result.error.code).toBe("invalid_response");
  });

  it("never puts the API key in an error message", async () => {
    for (const status of [400, 401, 429, 500]) {
      const { lookup } = lookupWith(() => json({ error: { message: API_KEY } }, status));
      const result = await lookup.search({ name: "x", city: "y" });
      expect(!result.ok && result.error.message).not.toContain(API_KEY);
    }
  });
});

describe("GooglePlacesLookup on saved real responses", () => {
  const real = realResponses as Record<string, unknown>;
  const lookFor = async (place: string) => {
    const { lookup } = lookupWith(() => json(real[place]));
    const result = await lookup.search({ name: place, city: "Bangkok" });
    if (!result.ok) throw new Error(result.error.message);
    return result.value[0];
  };
  const window = (date: string, from: string, to: string) => {
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    return { date, startMinute: minutes(from), endMinute: minutes(to) };
  };

  it("reads the real response shape and keeps Google's own name and links", async () => {
    const venue = await lookFor("Thipsamai Pad Thai");
    expect(venue.name).toBe("Thipsamai");
    expect(venue.businessStatus).toBe("operational");
    expect(venue.mapsUrl).toMatch(/^https:\/\//);
    expect(venue.address).toBeTruthy();
  });

  it("matches the short names an AI would propose to Google's longer names", async () => {
    const venue = await lookFor("Wat Arun");
    expect(namesMatch("Wat Arun", venue.name)).toBe(true);
    expect(namesMatch("Grand Palace", venue.name)).toBe(false);
  });

  // 12 Dec 2026 is a Saturday, 13 Dec a Sunday, 14 Dec a Monday.
  it("knows a temple that closes at 18:00 is shut for an evening slot", async () => {
    const hours = (await lookFor("Wat Arun")).hours;
    expect(hours && isOpenDuring(hours, window("2026-12-12", "12:30", "13:30"))).toBe(true);
    expect(hours && isOpenDuring(hours, window("2026-12-12", "17:30", "22:00"))).toBe(false);
  });

  it("reads hours that close at midnight (next day, 00:00) as open all evening", async () => {
    const hours = (await lookFor("Thipsamai Pad Thai")).hours;
    expect(hours && isOpenDuring(hours, window("2026-12-12", "17:30", "22:00"))).toBe(true);
    expect(hours && isOpenDuring(hours, window("2026-12-12", "08:00", "10:00"))).toBe(false);
  });

  it("treats a weekday missing from the periods as closed", async () => {
    const hours = (await lookFor("Thipsamai Pad Thai")).hours;
    // Google lists no period for Tuesday, so the place is closed that day.
    expect(hours && isOpenDuring(hours, window("2026-12-15", "12:00", "13:00"))).toBe(false);
    const market = (await lookFor("Chatuchak Weekend Market")).hours;
    expect(market && isOpenDuring(market, window("2026-12-13", "08:00", "18:30"))).toBe(true);
    expect(market && isOpenDuring(market, window("2026-12-14", "12:00", "13:00"))).toBe(false);
  });
});
