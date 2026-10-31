import { describe, expect, it } from "vitest";
import type { FlightQuery, HotelQuery } from "@/domain/offers/offer-source";
import flightsRoundTrip from "./fixtures/flights-round-trip.json";
import hotelsSingleRoom from "./fixtures/hotels-single-room.json";
import { LiteApiOfferSource } from "./liteapi-offer-source";

const API_KEY = "sand_test_key_that_must_never_leak";
const NOW = new Date("2026-10-27T01:00:00Z");

interface RecordedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

/** A fake `fetch` that answers every call with one canned response and records what was sent. */
function fakeFetch(respond: () => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function sourceWith(respond: () => Response | Promise<Response>) {
  const { fetchImpl, calls } = fakeFetch(respond);
  const source = new LiteApiOfferSource({
    apiKey: API_KEY,
    currency: "USD",
    guestNationality: "SG",
    fetchImpl,
    clock: () => NOW,
  });
  return { source, calls };
}

const hotelQuery: HotelQuery = {
  kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-11", checkOut: "2026-12-13", guests: 3,
};
const flightQuery: FlightQuery = {
  kind: "flight", city: "Bangkok", origin: "SIN", destination: "BKK", departDate: "2026-12-11", returnDate: "2026-12-13", guests: 4,
};

const errorCode = (result: { ok: boolean; error?: { code: string } }): string | null =>
  result.ok ? null : (result.error?.code ?? null);

describe("hotel search", () => {
  it("sends one room for the guests, with the key in a header and not in the body", async () => {
    const { source, calls } = sourceWith(() => json(hotelsSingleRoom));
    await source.search(hotelQuery);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.liteapi.travel/v3.0/hotels/rates");
    expect(calls[0].headers["X-API-Key"]).toBe(API_KEY);
    expect(JSON.stringify(calls[0].body)).not.toContain(API_KEY);
    expect(calls[0].body).toMatchObject({
      checkin: "2026-12-11", checkout: "2026-12-13", currency: "USD", guestNationality: "SG",
      occupancies: [{ adults: 3 }], countryCode: "TH", cityName: "Bangkok", maxRatesPerHotel: 1,
    });
  });

  it("maps real responses to offers", async () => {
    const { source } = sourceWith(() => json(hotelsSingleRoom));
    const result = await source.search(hotelQuery);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(2);

    const [lebua, ascott] = result.value;
    expect(lebua).toMatchObject({
      kind: "hotel", title: "lebua at State Tower", roomName: "LEBUA SUITE CITY VIEW", stars: 5,
      totalMinor: 43412, currency: "USD", guests: 3, city: "Bangkok", provider: "liteapi",
      checkIn: "2026-12-11", checkOut: "2026-12-13",
      freeCancellationUntil: "2026-12-08T06:00:00.000Z",
      expiresAt: "2026-10-27T01:10:00.000Z",
    });
    expect(lebua.listingId.startsWith("lp35d80:")).toBe(true);
    expect(lebua.id).not.toBe(lebua.listingId);
    expect(ascott).toMatchObject({ title: "Ascott Thonglor Bangkok", totalMinor: 29757, roomName: "Deluxe Room" });
    expect(ascott.kind === "hotel" && ascott.freeCancellationUntil).toBeUndefined();
  });

  it("returns an empty list when liteAPI reports no availability", async () => {
    const { source } = sourceWith(() => json({ error: { code: 2001, message: "no availability found" } }));
    expect(await source.search(hotelQuery)).toEqual({ ok: true, value: [] });
  });

  it("leaves out a room it cannot price", async () => {
    const broken = structuredClone(hotelsSingleRoom);
    broken.data[0].roomTypes[0].offerRetailRate.amount = 0;
    const { source } = sourceWith(() => json(broken));
    const result = await source.search(hotelQuery);
    expect(result.ok && result.value.map((offer) => offer.title)).toEqual(["Ascott Thonglor Bangkok"]);
  });
});

describe("flight search", () => {
  it("asks for a round trip with an outbound and an inbound leg, one adult per guest", async () => {
    const { source, calls } = sourceWith(() => json(flightsRoundTrip));
    await source.search(flightQuery);
    expect(calls[0].url).toBe("https://api.liteapi.travel/v3.0/flights/rates");
    expect(calls[0].body).toEqual({
      legs: [
        { origin: "SIN", destination: "BKK", date: "2026-12-11", direction: "OUTBOUND" },
        { origin: "BKK", destination: "SIN", date: "2026-12-13", direction: "INBOUND" },
      ],
      adults: 4, currency: "USD", cabinClass: "ECONOMY",
    });
  });

  it("asks for the cabin the group needs and records it on every fare, so a business need can be checked", async () => {
    const { source, calls } = sourceWith(() => json(flightsRoundTrip));
    const result = await source.search({ ...flightQuery, cabinClass: "BUSINESS" });
    expect(calls[0].body.cabinClass).toBe("BUSINESS");
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.map((offer) => offer.kind === "flight" && offer.cabin)).toEqual(["BUSINESS", "BUSINESS", "BUSINESS"]);
  });

  it("asks for one leg when there is no return date", async () => {
    const { source, calls } = sourceWith(() => json(flightsRoundTrip));
    await source.search({ ...flightQuery, returnDate: undefined });
    expect(calls[0].body.legs).toEqual([{ origin: "SIN", destination: "BKK", date: "2026-12-11", direction: "OUTBOUND" }]);
  });

  it("maps real responses to offers keyed by journey", async () => {
    const { source } = sourceWith(() => json(flightsRoundTrip));
    const result = await source.search(flightQuery);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(3);

    const first = result.value[0];
    if (first.kind !== "flight") throw new Error("expected a flight");
    expect(first).toMatchObject({
      title: "SIN to BKK", city: "Bangkok", currency: "USD", totalMinor: 106743, guests: 4, refundable: false,
      provider: "liteapi", listingId: "84c97554838a65a7",
    });
    expect(first.legs).toHaveLength(2);
    expect(first.legs[0]).toMatchObject({ origin: "SIN", destination: "BKK", departAt: "2026-12-11T09:15:00", carrier: "Scoot", direction: "outbound" });
    expect(first.legs[1]).toMatchObject({ origin: "BKK", destination: "SIN", departAt: "2026-12-13T17:00:00", direction: "inbound" });
    expect(first.id).not.toBe(first.listingId);
    expect(first.expiresAt).toBe("2026-10-27T01:27:09.481Z");
  });

  it("titles a flight with the airports it really uses, not the ones that were searched", async () => {
    const response = structuredClone(flightsRoundTrip) as { data: { journeys: { segments: { direction: string; destinationCode: string }[] }[] }[] };
    for (const segment of response.data[0].journeys[0].segments) if (segment.direction === "OUTBOUND") segment.destinationCode = "DMK";
    const { source } = sourceWith(() => json(response));
    const result = await source.search(flightQuery);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value[0].title).toBe("SIN to DMK");
  });

  it("returns an empty list for a route with no flights", async () => {
    const { source } = sourceWith(() => json({ data: [] }));
    expect(await source.search(flightQuery)).toEqual({ ok: true, value: [] });
  });
});

describe("failures", () => {
  it.each([
    [401, "source_unavailable", "rejected the API key"],
    [403, "source_unavailable", "rejected the API key"],
    [429, "source_unavailable", "rate limiting"],
    [500, "source_unavailable", "had an error (500)"],
    [503, "source_unavailable", "had an error (503)"],
    [404, "source_unavailable", "refused the request (404)"],
  ])("maps HTTP %i to %s", async (status, code, message) => {
    const { source } = sourceWith(() => json({ error: { code: status, message: "x" } }, status));
    const result = await source.search(hotelQuery);
    expect(errorCode(result)).toBe(code);
    expect(!result.ok && result.error.message).toContain(message);
  });

  it("reports a rejected search as an invalid query, with liteAPI's reason", async () => {
    const body = { error: { code: 41012, description: "cannot be in the past", message: "search input validation error" } };
    const { source } = sourceWith(() => json(body, 400));
    const result = await source.search(flightQuery);
    expect(errorCode(result)).toBe("invalid_query");
    expect(!result.ok && result.error.message).toContain("cannot be in the past");
  });

  it("reports other errors in a 200 response as the source being unavailable", async () => {
    const { source } = sourceWith(() => json({ error: { code: 5000, message: "supplier timeout" } }));
    const result = await source.search(hotelQuery);
    expect(errorCode(result)).toBe("source_unavailable");
    expect(!result.ok && result.error.message).toContain("supplier timeout");
  });

  it("reports a network failure or timeout as the source being unavailable", async () => {
    const { source } = sourceWith(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    const result = await source.search(hotelQuery);
    expect(errorCode(result)).toBe("source_unavailable");
  });

  it("reports a body that is not JSON, or has the wrong shape", async () => {
    const notJson = sourceWith(() => new Response("<html>oops</html>", { status: 200 }));
    expect(errorCode(await notJson.source.search(hotelQuery))).toBe("invalid_response");

    const wrongShape = sourceWith(() => json({ data: [{ hotelId: 7 }] }));
    expect(errorCode(await wrongShape.source.search(hotelQuery))).toBe("invalid_response");
    const wrongFlights = sourceWith(() => json({ data: "nope" }));
    expect(errorCode(await wrongFlights.source.search(flightQuery))).toBe("invalid_response");
  });

  it("never puts the API key in an error message", async () => {
    for (const status of [400, 401, 429, 500]) {
      const { source } = sourceWith(() => json({ error: { message: "bad" } }, status));
      const result = await source.search(hotelQuery);
      expect(!result.ok && result.error.message).not.toContain(API_KEY);
    }
  });

  it("does not search for activities", async () => {
    const { source, calls } = sourceWith(() => json({}));
    const result = await source.search({ kind: "activity", city: "Bangkok", date: "2026-12-12", guests: 2 });
    expect(errorCode(result)).toBe("invalid_query");
    expect(calls).toHaveLength(0);
  });
});

describe("excluded hotel charges", () => {
  const withFees = (fees: unknown[]) => {
    const body = structuredClone(hotelsSingleRoom);
    body.data[0].roomTypes[0].rates[0].retailRate.taxesAndFees = fees as never;
    return body;
  };

  it("keeps charges liteAPI says are not in the price, as minor units", async () => {
    const { source } = sourceWith(() =>
      json(withFees([
        { included: true, description: "sales tax", amount: 28.68, currency: "USD" },
        { included: false, description: "City tax ", amount: 9, currency: "USD" },
      ])),
    );
    const result = await source.search(hotelQuery);
    const lebua = result.ok ? result.value[0] : null;
    expect(lebua?.kind === "hotel" && lebua.excludedCharges).toEqual([{ description: "City tax", amountMinor: 900, currency: "USD" }]);
  });

  it("has none when everything is included, as in the real sandbox responses", async () => {
    const { source } = sourceWith(() => json(hotelsSingleRoom));
    const result = await source.search(hotelQuery);
    expect(result.ok && result.value.every((offer) => offer.kind === "hotel" && offer.excludedCharges?.length === 0)).toBe(true);
  });

  it("skips a charge it cannot price", async () => {
    const { source } = sourceWith(() => json(withFees([{ included: false, description: "Odd", amount: 0, currency: "USD" }])));
    const result = await source.search(hotelQuery);
    expect(result.ok && result.value[0].kind === "hotel" && result.value[0].excludedCharges).toEqual([]);
  });
});
