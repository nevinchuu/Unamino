import { describe, expect, it } from "vitest";
import type { FlightQuery, HotelQuery, OfferQuery } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import { refreshPlan } from "@/domain/plan/refresh";
import { MemoryDetailsStore, MemoryPlanRepository, memberSnapshot } from "@/domain/plan/test-support";
import { LiteApiOfferSource } from "./liteapi/liteapi-offer-source";

/**
 * Checks on the real liteAPI sandbox that a listing can be found again by its listing id after a second search,
 * which is what renewing a plan relies on. Two searches per kind, no model calls, so no cost beyond the sandbox.
 * Skipped unless asked for:
 *   REFRESH_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run refresh.live
 */
const LIVE = process.env.REFRESH_LIVE === "1";
const NOW = new Date();
const GUESTS = 2;
const HOTEL_QUERY: HotelQuery = { kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-11", checkOut: "2026-12-13", guests: GUESTS };
const FLIGHT_QUERY: FlightQuery = { kind: "flight", city: "Bangkok", origin: "SIN", destination: "BKK", departDate: "2026-12-11", returnDate: "2026-12-13", guests: GUESTS };

describe.skipIf(!LIVE)("renewing a plan against the real liteAPI sandbox", () => {
  const source = (): LiteApiOfferSource => {
    const apiKey = process.env.LITEAPI_KEY;
    if (!apiKey) throw new Error("LITEAPI_KEY is needed");
    return new LiteApiOfferSource({ apiKey, currency: "USD", guestNationality: "SG", timeoutMs: 45_000 });
  };

  async function search(liteApi: LiteApiOfferSource, query: OfferQuery): Promise<readonly Offer[]> {
    const result = await liteApi.search(query);
    if (!result.ok) throw new Error(`${query.kind} search failed: ${result.error.message}`);
    return result.value;
  }

  // Flights get a new offer id on every search; hotels keep theirs. Only the listing id can be relied on for both.
  it.each([["hotel", HOTEL_QUERY], ["flight", FLIGHT_QUERY]] as const)("finds a %s again by its listing id, with a later expiry", async (_kind, query) => {
    const liteApi = source();
    const first = await search(liteApi, query);
    expect(first.length).toBeGreaterThan(0);
    const chosen = first[0];

    const second = await search(liteApi, query);
    const again = second.filter((offer) => offer.listingId === chosen.listingId);
    console.info(`${query.kind}: ${first.length} offers, ${second.length} the second time, ${again.length} with the chosen listing id`);

    expect(again.length).toBeGreaterThan(0);
    if (query.kind === "flight") expect(again.every((offer) => offer.id !== chosen.id)).toBe(true);
    expect(new Date(again[0].expiresAt).getTime()).toBeGreaterThan(new Date(chosen.expiresAt).getTime());
  }, 120_000);

  it("renews a two-pick plan end to end: deadline moves, nothing is lost", async () => {
    const liteApi = source();
    const [hotels, flights] = await Promise.all([search(liteApi, HOTEL_QUERY), search(liteApi, FLIGHT_QUERY)]);
    const [hotel, flight] = [hotels[0], flights[0]];
    const everyone = ["ana", "ben"];
    const deadlineAt = new Date(Math.min(new Date(hotel.expiresAt).getTime(), new Date(flight.expiresAt).getTime()));

    const plans = new MemoryPlanRepository({
      id: "plan-1",
      version: 1,
      plan: { status: "reviewing", deadlineAt, hardDeadlineAt: new Date(NOW.getTime() + 48 * 3_600_000), members: everyone.map((id) => memberSnapshot(id)) },
    });
    const details = new MemoryDetailsStore({
      planId: "plan-1",
      baseCurrency: "USD",
      fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} },
      offersCheckedAt: null,
      members: everyone.map((id) => ({ id, currency: "USD" })),
      picks: [
        { id: "pick-hotel", offer: hotel, searchId: "s-hotel", memberIds: everyone },
        { id: "pick-flight", offer: flight, searchId: "s-flight", memberIds: everyone },
      ],
      queries: new Map<string, OfferQuery>([["s-hotel", HOTEL_QUERY], ["s-flight", FLIGHT_QUERY]]),
    });

    const outcome = await refreshPlan({ plans, details, source: liteApi, search: { retries: 1 } }, "plan-1", new Date());
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
    console.info(`refresh: ${outcome.value.status}`, outcome.value.status === "refreshed" ? { extended: outcome.value.deadlineExtended, shares: outcome.value.shares.map((s) => s.shareMinor) } : outcome.value);

    expect(outcome.value.status).toBe("refreshed");
    expect(plans.plan.deadlineAt.getTime()).toBeGreaterThan(deadlineAt.getTime());
    expect(details.details.picks.map((pick) => pick.offer.listingId)).toEqual([hotel.listingId, flight.listingId]);
  }, 180_000);
});
