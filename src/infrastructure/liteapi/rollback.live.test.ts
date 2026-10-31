import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ok } from "@/lib/result";
import { bookingFailedLine, failureSummary, undoneSentence } from "@/domain/booking/announce";
import { SupplierBookingRunner } from "@/domain/booking/booking-runner";
import { bookingSetup, MemoryFailureStore } from "@/domain/booking/test-support";
import type { HotelQuery } from "@/domain/offers/offer-source";
import { NOW } from "@/domain/plan/test-support";
import { travellerDetailsSchema } from "@/domain/travellers/details";
import { LiteApiBookingHttp } from "./booking-http";
import { LiteApiHotelSupplier } from "./hotel-booking";
import { LiteApiOfferSource } from "./liteapi-offer-source";

/**
 * Runs the real booking runner against the real liteAPI sandbox for a trip whose flight cannot be booked: a free-cancel hotel
 * is really booked, the airline (a stand-in that always says "sold out") refuses, and the runner must cancel the hotel for
 * real. Nothing real moves: it is the sandbox, with a made-up guest and no passport. Skipped unless asked for:
 *   ROLLBACK_LIVE=1 ROLLBACK_LIVE_OUT=<file> node --env-file=.env.local node_modules/vitest/vitest.mjs run rollback.live
 * What happened is written to the file, because Vitest hides console output.
 */
const LIVE = process.env.ROLLBACK_LIVE === "1";
const OUT = process.env.ROLLBACK_LIVE_OUT;
// Dates no other live test uses, so the rooms are not taken from each other.
const QUERY: HotelQuery = { kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-22", checkOut: "2026-12-24", guests: 2 };

const GUEST = travellerDetailsSchema.parse({
  firstName: "Alex", lastName: "Rivera", birthday: "1991-03-02", gender: "X", nationality: "SG",
  email: "alex.rivera@example.com", phoneCountryCode: "65", phoneNumber: "81234567",
});

describe.skipIf(!LIVE)("a failed flight after a real hotel booking", () => {
  it("cancels the hotel, ends the plan, lets go of the holds and says why", { timeout: 240_000 }, async () => {
    const apiKey = process.env.LITEAPI_KEY;
    if (!apiKey) throw new Error("LITEAPI_KEY is needed");
    const report: string[] = [];
    const flush = (): void => {
      if (OUT) writeFileSync(OUT, report.join("\n"));
    };

    const found = await new LiteApiOfferSource({ apiKey, currency: "USD", guestNationality: "SG", timeoutMs: 45_000 }).search(QUERY);
    if (!found.ok) throw new Error(`search failed: ${found.error.message}`);
    const rooms = found.value.filter((offer) => offer.kind === "hotel" && offer.freeCancellationUntil !== undefined).slice(0, 4);
    if (rooms.length === 0) throw new Error("no free-cancel rooms came back");

    const realHotels = new LiteApiHotelSupplier(new LiteApiBookingHttp({ apiKey }));
    // A sandbox rate can price out between the search and the booking, so the next free-cancel room is tried.
    for (const room of rooms) {
      const world = bookingSetup();
      world.details.details = {
        ...world.details.details,
        picks: world.details.details.picks.map((pick) => (pick.offer.kind === "hotel" ? { ...pick, offer: room } : pick)),
      };
      world.flights.failBooking = { code: "unavailable", message: "sold out" };
      const failures = new MemoryFailureStore();
      const lines: string[] = [];
      const runner = new SupplierBookingRunner({
        plans: world.plans, details: world.details, travellers: { load: async () => ok(GUEST) }, holds: world.holds,
        hotels: realHotels, flights: world.flights, bookings: world.bookings, onward: () => world.onward, clock: () => NOW,
        announce: async (_plan, line) => void lines.push(line), failures,
      });

      await runner.run("plan-1", 5, [{ type: "book" }]);
      const [record] = failures.saved;
      report.push(
        `room: ${room.kind === "hotel" ? room.title : ""} | ${room.totalMinor} ${room.currency} | free until ${room.kind === "hotel" ? room.freeCancellationUntil : ""}`,
        `plan: ${world.plans.plan.status}`,
        `hold effects: ${world.onward.types.join(", ")}`,
        `bookings kept: ${JSON.stringify(world.bookings.rows.map((row) => [row.kind, row.status]))}`,
        `failure kept: ${record ? `${record.reason} | ${record.part?.kind} ${record.part?.title}` : "none"}`,
        `chat line: ${record ? bookingFailedLine(record) : lines.join(" / ")}`,
        `failure card: ${record ? `${failureSummary(record)} | ${undoneSentence(record.undone) ?? ""}` : "none"}`,
        `flight attempts: ${world.flights.booked.length} booked, ${world.log.filter((entry) => entry === "book F").length} asked`,
      );
      flush();

      // The sandbox priced the room out before it could be booked: nothing was booked, so try the next room.
      if (world.bookings.rows.length === 0 && record?.part?.kind === "hotel") continue;

      expect(world.plans.plan.status).toBe("expired");
      expect(world.onward.types).toEqual(["release_holds"]);
      expect(world.bookings.rows.map((row) => [row.kind, row.status])).toEqual([["hotel", "cancelled"]]);
      expect(record?.part?.kind).toBe("flight");
      return;
    }
    throw new Error("no free-cancel room could be booked");
  });
});
