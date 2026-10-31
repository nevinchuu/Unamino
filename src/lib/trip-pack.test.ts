import { describe, expect, it } from "vitest";
import type { PlanItemDto, PlanViewDto } from "@/domain/plan/view";
import { buildCalendar, calendarFileName, itemLines } from "./trip-pack";

const NOW = new Date("2026-12-01T09:05:07Z");

const hotel: PlanItemDto = {
  id: "h", kind: "hotel", title: "Mövenpick Hotel Sukhumvit 15", memberNames: ["Maya"], reason: "", notes: [], totalMinor: 38_214, currency: "USD", bookingCode: "ABC123",
  roomName: "Superior, king bed", stay: "Tue 15 Dec to Fri 18 Dec · 3 nights", stars: 5, freeCancellationUntil: null, extraCharges: [],
};
const flight: PlanItemDto = {
  id: "f", kind: "flight", title: "SIN to BKK", memberNames: ["Maya"], reason: "", notes: [], totalMinor: 20_000, currency: "USD", bookingCode: null, refundable: false,
  legs: [{ direction: "outbound", route: "SIN to BKK", departs: "Tue 15 Dec 08:00", arrives: "Tue 15 Dec 09:30", carrier: "Scoot" }],
};

const view = (overrides: Partial<PlanViewDto> = {}): PlanViewDto => ({
  id: "7f3a2c11-0000-4000-8000-000000000000", groupId: "g", title: "Bangkok 3-night hotel stay", summary: null, status: "captured", city: "Bangkok", dates: "Tue 15 Dec to Fri 18 Dec",
  tripDates: { departDate: "2026-12-15", returnDate: "2026-12-18" }, keptUntil: "2027-01-17", headcount: 3, deadlineAt: "2026-12-01T00:00:00.000Z", replacedBy: null, reference: "UN-7F3A2C",
  payments: "stripe", demoBooking: false, currency: "USD", pricesAvailable: true, refundWarning: null, items: [flight, hotel], ideas: [], confirmations: [], progress: [], failure: null, people: [], covers: [],
  me: { id: "m", inPlan: true, agreement: "agreed", approval: "approved", shareMinor: 0, approvedMinor: 0, cardNeeded: false, awaitingDetails: false, details: { needed: false, passportRequired: false }, actions: { agree: false, decline: false, approve: false, declineAmount: false, requestChanges: false, cover: false } },
  ...overrides,
});

const unfold = (text: string): string => text.replaceAll("\r\n ", "");

describe("itemLines", () => {
  it("writes a hotel with its room, stay and booking code", () => {
    expect(itemLines(hotel)).toEqual(["Mövenpick Hotel Sukhumvit 15, Superior, king bed", "Tue 15 Dec to Fri 18 Dec · 3 nights", "Booking code: ABC123"]);
  });

  it("writes each leg of a flight, and no code line when there is none", () => {
    expect(itemLines(flight)).toEqual(["SIN to BKK", "Outbound: SIN to BKK, Tue 15 Dec 08:00 to Tue 15 Dec 09:30, Scoot"]);
  });
});

describe("buildCalendar", () => {
  it("makes one all-day event from the first day to the morning after the last", () => {
    const text = buildCalendar(view(), NOW) ?? "";
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("DTSTART;VALUE=DATE:20261215\r\n");
    expect(text).toContain("DTEND;VALUE=DATE:20261219\r\n");
    expect(text).toContain("DTSTAMP:20261201T090507Z\r\n");
    expect(text).toContain("UID:7f3a2c11-0000-4000-8000-000000000000@unamino\r\n");
  });

  it("puts the reference, hotel and booking code in the notes, and escapes commas, semicolons and line breaks", () => {
    const text = unfold(buildCalendar(view(), NOW) ?? "");
    expect(text).toContain("SUMMARY:Bangkok 3-night hotel stay\r\n");
    expect(text).toContain("LOCATION:Bangkok\r\n");
    expect(text).toContain("Reference UN-7F3A2C\\n\\nSIN to BKK\\nOutbound: SIN to BKK\\, Tue 15 Dec 08:00 to Tue 15 Dec 09:30\\, Scoot");
    expect(text).toContain("Mövenpick Hotel Sukhumvit 15\\, Superior\\, king bed\\nTue 15 Dec to Fri 18 Dec · 3 nights\\nBooking code: ABC123");
  });

  it("escapes a backslash and a semicolon in a title", () => {
    const text = buildCalendar(view({ title: "A;B\\C" }), NOW) ?? "";
    expect(text).toContain("SUMMARY:A\\;B\\\\C\r\n");
  });

  it("never lets a line run past 75 bytes, and never splits a character", () => {
    const long = view({ title: "é".repeat(100) });
    const text = buildCalendar(long, NOW) ?? "";
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(text)).toContain(`SUMMARY:${"é".repeat(100)}`);
  });

  it("uses the one date there is for a trip with no return, and none for a trip with no dates", () => {
    const oneDay = buildCalendar(view({ tripDates: { departDate: "2026-12-15", returnDate: null } }), NOW) ?? "";
    expect(oneDay).toContain("DTSTART;VALUE=DATE:20261215");
    expect(oneDay).toContain("DTEND;VALUE=DATE:20261216");
    expect(buildCalendar(view({ tripDates: { departDate: null, returnDate: null } }), NOW)).toBeNull();
  });

  it("carries no names of people, contact or card details", () => {
    const text = buildCalendar(view({ people: [] }), NOW) ?? "";
    expect(text).not.toMatch(/Maya|passport|4242|[\w.+-]+@[\w-]+\.[\w.]+/i);
  });
});

describe("calendarFileName", () => {
  it("is named for the reference people quote", () => {
    expect(calendarFileName("7f3a2c11-0000-4000-8000-000000000000")).toBe("unamino-UN-7F3A2C.ics");
  });
});
