import { describe, expect, it } from "vitest";
import { formatKeptUntil, RETENTION, recordKeptUntil, tripEndOf, tripKeptUntil } from "./policy";

describe("retention policy", () => {
  it("keeps a booked trip for 30 days after it ends", () => {
    expect(RETENTION.daysAfterTrip).toBe(30);
    expect(tripKeptUntil({ departDate: "2026-12-15", returnDate: "2026-12-18" })).toBe("2027-01-17");
  });

  it("counts from the return date, and from the departure date when there is no return", () => {
    expect(tripEndOf({ departDate: "2026-12-15", returnDate: "2026-12-18" })).toBe("2026-12-18");
    expect(tripEndOf({ departDate: "2026-12-15", returnDate: null })).toBe("2026-12-15");
    expect(tripKeptUntil({ departDate: "2026-12-15", returnDate: null })).toBe("2027-01-14");
  });

  it("has no date to keep until when the trip has none", () => {
    expect(tripKeptUntil({ departDate: null, returnDate: null })).toBeNull();
    expect(recordKeptUntil({ departDate: null, returnDate: null })).toBeNull();
  });

  it("crosses month and year ends, and a leap day", () => {
    expect(tripKeptUntil({ departDate: null, returnDate: "2026-12-10" })).toBe("2027-01-09");
    expect(tripKeptUntil({ departDate: null, returnDate: "2028-02-01" })).toBe("2028-03-02");
  });

  it("keeps the dispute record about 18 months after the trip", () => {
    expect(recordKeptUntil({ departDate: "2026-12-15", returnDate: "2026-12-18" })).toBe("2028-06-10");
  });

  it("refuses a date that is not a date", () => {
    expect(tripKeptUntil({ departDate: null, returnDate: "soon" })).toBeNull();
  });

  it("writes a date for people", () => {
    expect(formatKeptUntil("2027-01-14")).toBe("14 Jan 2027");
    expect(formatKeptUntil("2027-12-05")).toBe("5 Dec 2027");
    expect(formatKeptUntil("not a date")).toBe("not a date");
  });
});
