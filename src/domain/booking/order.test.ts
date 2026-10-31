import { describe, expect, it } from "vitest";
import { flight, hotel } from "@/domain/plan/test-support";
import type { StoredPick } from "@/domain/plan/details-store";
import { bookingOrder, isFreeToCancel, unprotectedParts } from "./order";

const NOW = new Date("2026-11-01T10:00:00Z");
const FREE_UNTIL = "2026-12-08T10:00:00Z";
const pick = (id: string, offer: StoredPick["offer"]): StoredPick => ({ id, offer, searchId: null, memberIds: ["ana", "ben"] });

const refundableHotel = pick("hotel", hotel({ freeCancellationUntil: FREE_UNTIL }));
const fixedHotel = pick("hotel", hotel());
const refundableFlight = pick("flight", flight({ refundable: true }));
const fixedFlight = pick("flight", flight({ refundable: false }));
const ids = (picks: readonly StoredPick[]) => picks.map((entry) => entry.id);

describe("isFreeToCancel", () => {
  it("is true for a refundable fare and for a hotel still inside its free-cancellation time", () => {
    expect(isFreeToCancel(flight({ refundable: true }), NOW)).toBe(true);
    expect(isFreeToCancel(hotel({ freeCancellationUntil: FREE_UNTIL }), NOW)).toBe(true);
  });

  it("is false for a fixed fare, a hotel with no free cancellation and a hotel whose free time has passed", () => {
    expect(isFreeToCancel(flight({ refundable: false }), NOW)).toBe(false);
    expect(isFreeToCancel(hotel(), NOW)).toBe(false);
    expect(isFreeToCancel(hotel({ freeCancellationUntil: "2026-10-31T10:00:00Z" }), NOW)).toBe(false);
  });
});

describe("bookingOrder", () => {
  it("books a free-cancel hotel before a fixed flight, so the hotel can be undone if the flight fails", () => {
    expect(ids(bookingOrder([fixedFlight, refundableHotel], NOW))).toEqual(["hotel", "flight"]);
  });

  it("books a refundable flight before a fixed hotel, so the flight can be undone if the hotel fails", () => {
    expect(ids(bookingOrder([fixedHotel, refundableFlight], NOW))).toEqual(["flight", "hotel"]);
  });

  it("books the hotel first when both can be undone, because a hotel cancels at once", () => {
    expect(ids(bookingOrder([refundableFlight, refundableHotel], NOW))).toEqual(["hotel", "flight"]);
  });

  it("books the hotel first when neither can be undone, so the smaller loss comes first", () => {
    expect(ids(bookingOrder([fixedFlight, fixedHotel], NOW))).toEqual(["hotel", "flight"]);
  });

  it("treats a hotel whose free time has run out as fixed", () => {
    const lapsed = pick("hotel", hotel({ freeCancellationUntil: "2026-10-31T10:00:00Z" }));
    expect(ids(bookingOrder([lapsed, refundableFlight], NOW))).toEqual(["flight", "hotel"]);
  });

  it("leaves out activities, and keeps the plan's own order among equals", () => {
    const first = { ...fixedHotel, id: "room-1" };
    const second = { ...fixedHotel, id: "room-2" };
    const activity = pick("walk", { kind: "activity", id: "a", listingId: "a", title: "Walk", provider: "t", city: "Bangkok", currency: "USD", totalMinor: 1_000, guests: 2, date: "2026-12-12", durationMinutes: 60, category: "tour", expiresAt: "2026-11-01T11:00:00Z" });
    expect(ids(bookingOrder([activity, first, second], NOW))).toEqual(["room-1", "room-2"]);
  });
});

describe("unprotectedParts", () => {
  it("is empty when at most one part cannot be cancelled for free, because it is booked last", () => {
    expect(unprotectedParts([fixedFlight, refundableHotel], NOW)).toEqual([]);
    expect(unprotectedParts([refundableFlight, refundableHotel], NOW)).toEqual([]);
    expect(unprotectedParts([fixedHotel, refundableFlight], NOW)).toEqual([]);
    expect(unprotectedParts([fixedHotel], NOW)).toEqual([]);
  });

  it("names every fixed part but the last one booked, since a later failure would leave those paid for", () => {
    expect(ids(unprotectedParts([fixedFlight, fixedHotel], NOW))).toEqual(["hotel"]);
  });
});
