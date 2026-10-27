import { describe, expect, it } from "vitest";
import { clock, dateRange, dayAndTime, nightsBetween, shortDay } from "./plan-format";

describe("shortDay", () => {
  it("writes the weekday, day and month of a date or of a local date and time", () => {
    expect(shortDay("2026-12-11")).toBe("Fri 11 Dec");
    expect(shortDay("2026-12-11T20:10")).toBe("Fri 11 Dec");
    expect(shortDay("2026-12-14T00:55:00+08:00")).toBe("Mon 14 Dec");
  });

  it("does not move a time to another zone, so late flights stay on their own day", () => {
    expect(shortDay("2026-12-11T23:55:00-05:00")).toBe("Fri 11 Dec");
  });

  it("gives back what it cannot read", () => {
    expect(shortDay("soon")).toBe("soon");
    expect(shortDay("")).toBe("");
  });
});

describe("dayAndTime and clock", () => {
  it("shows the clock time as written at the airport", () => {
    expect(dayAndTime("2026-12-11T20:10:00+08:00")).toBe("Fri 11 Dec, 20:10");
    expect(clock("2026-12-11T20:10:00+08:00")).toBe("20:10");
  });

  it("copes with a date that has no time", () => {
    expect(dayAndTime("2026-12-11")).toBe("Fri 11 Dec");
    expect(clock("2026-12-11")).toBeNull();
    expect(clock("nonsense")).toBeNull();
  });
});

describe("nightsBetween", () => {
  it("counts the nights of a stay", () => {
    expect(nightsBetween("2026-12-11", "2026-12-13")).toBe(2);
    expect(nightsBetween("2026-12-31", "2027-01-02")).toBe(2);
  });

  it("is null for a stay that does not make sense", () => {
    expect(nightsBetween("2026-12-13", "2026-12-11")).toBeNull();
    expect(nightsBetween("2026-12-11", "2026-12-11")).toBeNull();
    expect(nightsBetween("x", "2026-12-11")).toBeNull();
  });
});

describe("dateRange", () => {
  it("joins both ends, or shows the one it has, or nothing", () => {
    expect(dateRange("2026-12-11", "2026-12-13")).toBe("Fri 11 Dec to Sun 13 Dec");
    expect(dateRange("2026-12-11", null)).toBe("Fri 11 Dec");
    expect(dateRange(null, "2026-12-13")).toBe("Sun 13 Dec");
    expect(dateRange(null, null)).toBeNull();
  });
});
