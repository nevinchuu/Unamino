import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prefilterOffers } from "@/domain/planner/prefilter";
import { LiteApiOfferSource } from "./liteapi-offer-source";

/**
 * Searches the real liteAPI sandbox for Bangkok hotels, so it is skipped unless asked for:
 *   REFUNDABLE_LIVE=1 REFUNDABLE_LIVE_OUT=<file> node --env-file=.env.local node_modules/vitest/vitest.mjs run refundable.live
 * It books nothing and uses no traveller data. It writes how many rooms came back and whether the shortlist shows a room
 * that can be cancelled for free.
 */
const LIVE = process.env.REFUNDABLE_LIVE === "1";
const OUT = process.env.REFUNDABLE_LIVE_OUT;

describe.skipIf(!LIVE)("hotel search against the real sandbox", () => {
  it("finds rooms that can be cancelled for free and keeps one in the shortlist", { timeout: 120_000 }, async () => {
    const apiKey = process.env.LITEAPI_KEY;
    if (!apiKey) throw new Error("LITEAPI_KEY is not set");
    const source = new LiteApiOfferSource({ apiKey, currency: "USD", guestNationality: "SG" });
    const now = new Date();
    const found = await source.search({ kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-11", checkOut: "2026-12-13", guests: 2 });
    expect(found.ok).toBe(true);
    if (!found.ok) return;

    const hotels = found.value.filter((offer) => offer.kind === "hotel");
    const free = hotels.filter((offer) => offer.kind === "hotel" && offer.freeCancellationUntil !== undefined);
    const shortlist = prefilterOffers({ offers: found.value, constraints: {}, now, limits: { flightsPerSlot: 5, hotelsPerSlot: 2, activitiesPerDay: 0 } }).offers;
    const shortlistFree = shortlist.filter((offer) => offer.kind === "hotel" && offer.freeCancellationUntil !== undefined);
    const lines = [`rooms found: ${hotels.length}`, `free to cancel: ${free.length}`, `shortlist: ${shortlist.length}`, `shortlist free to cancel: ${shortlistFree.length}`];
    if (OUT) writeFileSync(OUT, lines.join("\n"));
    expect(free.length).toBeGreaterThan(0);
    expect(shortlistFree.length).toBeGreaterThan(0);
  });
});
