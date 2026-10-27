import { describe, expect, it } from "vitest";
import fixtureData from "@/data/fixture-offers.json";
import { FixtureOfferSource, parseFixtureOffers } from "./fixture-offer-source";
import type { HotelQuery, OfferQuery } from "./offer-source";
import { isOfferExpired, offerSchema, type Offer } from "./schema";

const NOW = new Date("2026-10-27T01:00:00Z");

const parsed = parseFixtureOffers(fixtureData);
if (!parsed.ok) throw new Error(parsed.error.message);
const source = new FixtureOfferSource(parsed.value, () => NOW);

const hotelQuery = (guests: number): HotelQuery => ({
  kind: "hotel",
  city: "Bangkok",
  countryCode: "TH",
  checkIn: "2026-12-11",
  checkOut: "2026-12-13",
  guests,
});

async function search(query: OfferQuery): Promise<readonly Offer[]> {
  const result = await source.search(query);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("fixture data", () => {
  it("has six valid offers", () => {
    expect(parsed.ok && parsed.value).toHaveLength(6);
  });

  it("has unique offer ids", () => {
    const ids = parsed.ok ? parsed.value.map((offer) => offer.id) : [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects bad data with a readable message", () => {
    const result = parseFixtureOffers([{ kind: "hotel", id: "x" }]);
    expect(result.ok ? null : result.error.code).toBe("invalid_response");
  });

  it("rejects an offer with a non-integer price", () => {
    const bad = (fixtureData as unknown[]).map((offer) => ({ ...(offer as object), totalMinor: 10.5 }));
    expect(parseFixtureOffers(bad).ok).toBe(false);
  });
});

describe("FixtureOfferSource", () => {
  it("finds hotel offers for the exact number of guests", async () => {
    expect((await search(hotelQuery(3))).map((offer) => offer.id)).toEqual(["fx-htl-triple"]);
    expect((await search(hotelQuery(1))).map((offer) => offer.id)).toEqual(["fx-htl-single"]);
    expect(await search(hotelQuery(2))).toEqual([]);
  });

  it("finds round-trip flights for the right route and dates", async () => {
    const offers = await search({
      kind: "flight", city: "Bangkok", origin: "SIN", destination: "BKK", departDate: "2026-12-11", returnDate: "2026-12-13", guests: 4,
    });
    expect(offers.map((offer) => offer.id)).toEqual(["fx-flt-evening", "fx-flt-early"]);
  });

  it("does not return round trips for a one-way query", async () => {
    const offers = await search({ kind: "flight", city: "Bangkok", origin: "SIN", destination: "BKK", departDate: "2026-12-11", guests: 4 });
    expect(offers).toEqual([]);
  });

  it("does not match a different route, date or city", async () => {
    expect(await search({ kind: "flight", city: "Bangkok", origin: "BKK", destination: "SIN", departDate: "2026-12-11", returnDate: "2026-12-13", guests: 4 })).toEqual([]);
    expect(await search({ kind: "activity", city: "Bangkok", date: "2026-12-13", guests: 4 })).toEqual([]);
    expect(await search({ ...hotelQuery(3), city: "Phuket" })).toEqual([]);
  });

  it("finds activities by group size", async () => {
    const day = { kind: "activity", city: "Bangkok", date: "2026-12-12" } as const;
    expect((await search({ ...day, guests: 4 })).map((offer) => offer.id)).toEqual(["fx-act-market"]);
    expect((await search({ ...day, guests: 2 })).map((offer) => offer.id)).toEqual(["fx-act-cooking"]);
  });

  it("counts expiry from the time of the search and returns schema-valid offers", async () => {
    const [flight] = await search({ kind: "flight", city: "Bangkok", origin: "SIN", destination: "BKK", departDate: "2026-12-11", returnDate: "2026-12-13", guests: 4 });
    expect(flight.expiresAt).toBe("2026-10-27T01:09:00.000Z");
    expect(offerSchema.safeParse(flight).success).toBe(true);
    expect(isOfferExpired(flight, NOW)).toBe(false);
    expect(isOfferExpired(flight, new Date("2026-10-27T01:09:00Z"))).toBe(true);
  });

  it("keeps the same listing id across separate searches", async () => {
    const [first] = await search(hotelQuery(3));
    const [second] = await new FixtureOfferSource(parsed.ok ? parsed.value : [], () => new Date(NOW.getTime() + 60_000)).search(hotelQuery(3)).then((r) => (r.ok ? r.value : []));
    expect(second.listingId).toBe(first.listingId);
  });
});
