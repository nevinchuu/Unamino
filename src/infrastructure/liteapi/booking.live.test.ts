import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HotelQuery } from "@/domain/offers/offer-source";
import { travellerDetailsSchema } from "@/domain/travellers/details";
import { LiteApiBookingHttp } from "./booking-http";
import { LiteApiHotelSupplier } from "./hotel-booking";
import { LiteApiOfferSource } from "./liteapi-offer-source";

/**
 * Books and cancels one hotel room on the real liteAPI sandbox, which moves no real money, to check that the
 * requests and answers are what the code expects. It uses a made-up guest with no passport. Skipped unless asked for:
 *   BOOKING_LIVE=1 BOOKING_LIVE_OUT=<file> node --env-file=.env.local node_modules/vitest/vitest.mjs run booking.live
 * (Vitest hides console output, so what happened is written to the file.) Flights need a passport, so they are
 * checked through the app with a person filling in the form.
 */
const LIVE = process.env.BOOKING_LIVE === "1";
const OUT = process.env.BOOKING_LIVE_OUT;
// Other dates than the renewal live test uses: this one books the first room it finds, and the two must not take each other's rooms.
const QUERY: HotelQuery = { kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-18", checkOut: "2026-12-20", guests: 2 };

const note = (line: string): void => {
  if (OUT) appendFileSync(OUT, `${line}\n`);
};

const GUEST = travellerDetailsSchema.parse({
  firstName: "Alex", lastName: "Rivera", birthday: "1991-03-02", gender: "X", nationality: "SG",
  email: "alex.rivera@example.com", phoneCountryCode: "65", phoneNumber: "81234567",
});

describe.skipIf(!LIVE)("booking a hotel on the real liteAPI sandbox", () => {
  it("prebooks, books and then cancels a room", async () => {
    const apiKey = process.env.LITEAPI_KEY;
    if (!apiKey) throw new Error("LITEAPI_KEY is needed");
    const source = new LiteApiOfferSource({ apiKey, currency: "USD", guestNationality: "SG", timeoutMs: 45_000 });
    const found = await source.search(QUERY);
    if (!found.ok) throw new Error(`search failed: ${found.error.message}`);
    const rooms = found.value.filter((offer) => offer.kind === "hotel").slice(0, 4);
    if (rooms.length === 0) throw new Error("no hotel offers came back");

    const supplier = new LiteApiHotelSupplier(new LiteApiBookingHttp({ apiKey }));
    // A sandbox rate can price out between the search and the booking. That is the supplier's say, so the next room is tried.
    let booked: Awaited<ReturnType<LiteApiHotelSupplier["book"]>> | null = null;
    for (const room of rooms) {
      if (room.kind !== "hotel") continue;
      note(`room: ${room.title} | ${room.totalMinor} ${room.currency} | guests ${room.guests}`);
      booked = await supplier.book({ offer: room, reference: `live-check:${Date.now()}:${room.id}`, lead: { memberId: "live", details: GUEST }, maxTotalMinor: room.totalMinor });
      note(`book: ${JSON.stringify(booked.ok ? { ok: true, bookingId: booked.value.bookingId, confirmation: booked.value.confirmation } : booked)}`);
      if (booked.ok || booked.error.code !== "price_changed") break;
    }
    expect(booked?.ok).toBe(true);
    if (!booked?.ok) return;

    const cancelled = await supplier.cancel(booked.value.bookingId);
    note(`cancel: ${JSON.stringify(cancelled)}`);
    expect(cancelled).toEqual({ ok: true, value: "cancelled" });
  }, 180_000);
});
