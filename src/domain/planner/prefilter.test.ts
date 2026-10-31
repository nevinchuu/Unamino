import { describe, expect, it } from "vitest";
import type { ActivityOffer, FlightOffer, HotelOffer, Offer } from "@/domain/offers/schema";
import { prefilterOffers } from "./prefilter";
import { BANGKOK_CONSTRAINTS, BANGKOK_OFFERS, NOW } from "./test-support";

const baseFlight = BANGKOK_OFFERS.find((offer): offer is FlightOffer => offer.id === "fx-flt-evening");
const baseHotel = BANGKOK_OFFERS.find((offer): offer is HotelOffer => offer.id === "fx-htl-triple");
const baseActivity = BANGKOK_OFFERS.find((offer): offer is ActivityOffer => offer.id === "fx-act-market");
if (!baseFlight || !baseHotel || !baseActivity) throw new Error("fixture offers are missing");

/** A round-trip flight leaving SIN at `departTime` on 11 Dec. */
const flight = (id: string, departTime: string, totalMinor: number, overrides: Partial<FlightOffer> = {}): FlightOffer => ({
  ...baseFlight,
  id,
  listingId: `listing-${id}`,
  totalMinor,
  legs: baseFlight.legs.map((leg) => (leg.direction === "outbound" ? { ...leg, departAt: `2026-12-11T${departTime}:00+08:00` } : leg)),
  ...overrides,
});
const hotel = (id: string, guests: number, totalMinor: number): HotelOffer => ({ ...baseHotel, id, listingId: `listing-${id}`, guests, totalMinor });
const activity = (id: string, category: string, totalMinor: number, date = "2026-12-12"): ActivityOffer => ({
  ...baseActivity,
  id,
  listingId: `listing-${id}`,
  category,
  totalMinor,
  date,
});

const idsOf = (offers: readonly Offer[]): string[] => offers.map((offer) => offer.id);
const run = (offers: readonly Offer[], constraints = BANGKOK_CONSTRAINTS, limits?: Parameters<typeof prefilterOffers>[0]["limits"]) =>
  prefilterOffers({ offers, constraints, now: NOW, limits });

describe("expired offers", () => {
  it("drops them and counts them", () => {
    const stale: Offer = { ...flight("stale", "20:00", 50000), expiresAt: new Date(NOW.getTime() - 1).toISOString() };
    const result = run([stale, flight("fresh", "20:00", 60000)]);
    expect(idsOf(result.offers)).toEqual(["fresh"]);
    expect(result.expiredCount).toBe(1);
    expect(result.prunedCount).toBe(0);
  });

  it("treats an offer expiring exactly now as expired", () => {
    const edge: Offer = { ...flight("edge", "20:00", 50000), expiresAt: NOW.toISOString() };
    expect(run([edge]).offers).toEqual([]);
  });
});

describe("flights", () => {
  // Ana can only leave after 18:00. Cheap early flights break that; pricier evening ones do not.
  const early = Array.from({ length: 6 }, (_, i) => flight(`early-${i}`, "07:00", 30000 + i * 100));
  const evening = Array.from({ length: 3 }, (_, i) => flight(`evening-${i}`, "20:00", 90000 + i * 100));

  it("keeps a pricier flight that fits everyone's times over cheap ones that do not", () => {
    const kept = idsOf(run([...early, ...evening]).offers);
    expect(kept).toEqual(expect.arrayContaining(["evening-0", "evening-1", "evening-2"]));
    expect(kept).toHaveLength(5);
  });

  it("fills the rest of the slot with the cheapest of those that break the same number of constraints", () => {
    const kept = idsOf(run([...early, ...evening]).offers);
    expect(kept).toEqual(expect.arrayContaining(["early-0", "early-1"]));
    expect(kept).not.toContain("early-5");
  });

  it("ranks by price alone when nobody has a constraint", () => {
    const flights = [flight("c", "20:00", 70000), flight("a", "07:00", 50000), flight("b", "13:00", 60000)];
    const result = run(flights, {}, { flightsPerSlot: 2, hotelsPerSlot: 3, activitiesPerDay: 4 });
    expect(idsOf(result.offers)).toEqual(["a", "b"]);
  });

  it("keeps different dates and party sizes in separate slots", () => {
    const otherDay = flight("other-day", "20:00", 90000, {
      legs: baseFlight.legs.map((leg) => (leg.direction === "outbound" ? { ...leg, departAt: "2026-12-12T20:10:00+08:00" } : leg)),
    });
    const smallParty = flight("small-party", "20:00", 90000, { guests: 2 });
    const result = run([...early, otherDay, smallParty], BANGKOK_CONSTRAINTS, { flightsPerSlot: 1, hotelsPerSlot: 3, activitiesPerDay: 4 });
    expect(idsOf(result.offers)).toEqual(expect.arrayContaining(["other-day", "small-party"]));
    expect(result.offers).toHaveLength(3);
  });

});

describe("hotels", () => {
  it("never lets triple rooms crowd out the single rooms", () => {
    const rooms = [...Array.from({ length: 5 }, (_, i) => hotel(`triple-${i}`, 3, 40000 + i * 100)), ...Array.from({ length: 5 }, (_, i) => hotel(`single-${i}`, 1, 20000 + i * 100))];
    const kept = idsOf(run(rooms).offers);
    expect(kept.filter((id) => id.startsWith("triple"))).toHaveLength(3);
    expect(kept.filter((id) => id.startsWith("single"))).toHaveLength(3);
  });

  it("keeps the cheapest rooms of a size", () => {
    const rooms = [hotel("c", 3, 43000), hotel("a", 3, 41000), hotel("b", 3, 42000), hotel("d", 3, 44000)];
    expect(idsOf(run(rooms).offers)).toEqual(["c", "a", "b"]);
  });

  describe("a room that can be cancelled for free", () => {
    const FREE_UNTIL = "2026-12-08T10:00:00Z";
    const fixed = (id: string, totalMinor: number): HotelOffer => ({ ...hotel(id, 3, totalMinor), freeCancellationUntil: undefined });
    const withFreeCancel = (id: string, totalMinor: number): HotelOffer => ({ ...hotel(id, 3, totalMinor), freeCancellationUntil: FREE_UNTIL });
    const limits = { flightsPerSlot: 5, hotelsPerSlot: 2, activitiesPerDay: 4 };
    const runWith = (offers: readonly Offer[]) => prefilterOffers({ offers, constraints: {}, now: NOW, limits });

    it("is shown even when it costs more than the cheapest rooms, in place of the last pick", () => {
      const rooms = [fixed("cheap-1", 40_000), fixed("cheap-2", 41_000), fixed("cheap-3", 42_000), withFreeCancel("flexible", 48_000)];
      expect(idsOf(runWith(rooms).offers)).toEqual(["cheap-1", "flexible"]);
    });

    it("does not displace anything when one is already among the cheapest", () => {
      const rooms = [fixed("cheap-1", 40_000), withFreeCancel("flexible", 41_000), fixed("cheap-3", 42_000)];
      expect(idsOf(runWith(rooms).offers)).toEqual(["cheap-1", "flexible"]);
    });

    it("keeps the two cheapest when no room can be cancelled for free", () => {
      const rooms = [fixed("a", 40_000), fixed("b", 41_000), fixed("c", 42_000)];
      expect(idsOf(runWith(rooms).offers)).toEqual(["a", "b"]);
    });

    it("ignores a room whose free-cancellation time has already passed", () => {
      const lapsed: HotelOffer = { ...fixed("lapsed", 48_000), freeCancellationUntil: "2026-10-26T10:00:00Z" };
      const rooms = [fixed("a", 40_000), fixed("b", 41_000), lapsed];
      expect(idsOf(runWith(rooms).offers)).toEqual(["a", "b"]);
    });
  });
});

describe("activities", () => {
  it("keeps variety: the cheapest of each category before a second of the same kind", () => {
    const acts = [
      activity("tour-1", "tour", 1000),
      activity("tour-2", "tour", 1100),
      activity("tour-3", "tour", 1200),
      activity("cooking-1", "cooking", 9000),
      activity("market-1", "market", 8000),
    ];
    const kept = idsOf(run(acts).offers);
    expect(kept).toEqual(expect.arrayContaining(["tour-1", "cooking-1", "market-1"]));
    expect(kept).toHaveLength(4);
  });

  it("does not drop an activity because some member skips it: they just do not join", () => {
    expect(idsOf(run([activity("class", "cooking", 9000)]).offers)).toEqual(["class"]);
  });

  it("compares price per guest, not the total", () => {
    const pair = activity("pair", "tour", 9000);
    const group = activity("group", "market", 12000);
    const result = run([{ ...pair, guests: 2 }, { ...group, guests: 4 }], {}, { flightsPerSlot: 5, hotelsPerSlot: 3, activitiesPerDay: 1 });
    // 9000 for 2 is 4500 each; 12000 for 4 is 3000 each, so the bigger total is the cheaper per person.
    expect(idsOf(result.offers)).toEqual(["group"]);
  });

  it("limits each day separately", () => {
    const acts = [...Array.from({ length: 5 }, (_, i) => activity(`sat-${i}`, `cat-${i}`, 1000 + i)), ...Array.from({ length: 5 }, (_, i) => activity(`sun-${i}`, `cat-${i}`, 1000 + i, "2026-12-13"))];
    expect(run(acts).offers).toHaveLength(8);
  });
});

describe("the whole search", () => {
  it("passes the six wireframe fixtures through untouched", () => {
    const result = run(BANGKOK_OFFERS);
    expect(idsOf(result.offers)).toEqual(idsOf(BANGKOK_OFFERS));
    expect(result.prunedCount).toBe(0);
  });

  it("cuts hundreds of flights down to the slot size", () => {
    const flights = Array.from({ length: 300 }, (_, i) => flight(`f-${i}`, i % 2 === 0 ? "07:00" : "20:00", 30000 + i));
    const result = run(flights);
    expect(result.offers).toHaveLength(5);
    expect(result.prunedCount).toBe(295);
  });

  it("is deterministic and keeps the original order", () => {
    const offers = [...BANGKOK_OFFERS, ...Array.from({ length: 20 }, (_, i) => flight(`f-${i}`, "20:00", 90000 + i))];
    const first = run(offers);
    expect(idsOf(run([...offers]).offers)).toEqual(idsOf(first.offers));
    const positions = first.offers.map((offer) => offers.indexOf(offer));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("does not change its input", () => {
    const offers = [flight("b", "20:00", 70000), flight("a", "20:00", 60000)];
    const copy = [...offers];
    run(offers);
    expect(offers).toEqual(copy);
  });

  it("returns nothing for no offers", () => {
    expect(run([])).toEqual({ offers: [], expiredCount: 0, prunedCount: 0 });
  });
});
