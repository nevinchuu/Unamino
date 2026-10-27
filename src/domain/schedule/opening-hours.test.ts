import { describe, expect, it } from "vitest";
import { isOpenDuring, MINUTES_PER_WEEK, toOpeningHours, type WeekPeriod } from "./opening-hours";
import { namesMatch } from "./venue";

const period = (openDay: number, openTime: string, closeDay: number, closeTime: string): WeekPeriod => {
  const [oh, om] = openTime.split(":").map(Number);
  const [ch, cm] = closeTime.split(":").map(Number);
  return { open: { day: openDay, hour: oh, minute: om }, close: { day: closeDay, hour: ch, minute: cm } };
};

// 2026-12-12 is a Saturday; 2026-12-13 is a Sunday; 2026-12-14 is a Monday.
const SATURDAY = "2026-12-12";
const SUNDAY = "2026-12-13";
const at = (date: string, from: string, to: string) => {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return { date, startMinute: fh * 60 + fm, endMinute: th * 60 + tm };
};

describe("toOpeningHours", () => {
  it("recognises a place that is always open", () => {
    expect(toOpeningHours([{ open: { day: 0, hour: 0, minute: 0 } }])).toEqual({ kind: "always" });
  });

  it("returns null for a period with no closing time that is not the always-open marker", () => {
    expect(toOpeningHours([{ open: { day: 3, hour: 9, minute: 0 } }])).toBeNull();
  });

  it("treats an empty list as never open", () => {
    expect(toOpeningHours([])).toEqual({ kind: "periods", intervals: [] });
  });

  it("joins periods that touch", () => {
    const hours = toOpeningHours([period(6, "11:00", 6, "15:00"), period(6, "15:00", 6, "22:00")]);
    expect(hours).toEqual({ kind: "periods", intervals: [{ openMinute: 6 * 1440 + 660, closeMinute: 6 * 1440 + 1320 }] });
  });

  it("wraps hours that run past Saturday night into the next week", () => {
    const hours = toOpeningHours([period(6, "22:00", 0, "02:00")]);
    expect(hours).toEqual({ kind: "periods", intervals: [{ openMinute: 6 * 1440 + 1320, closeMinute: MINUTES_PER_WEEK + 120 }] });
  });
});

describe("isOpenDuring", () => {
  const lunchAndDinner = toOpeningHours([period(6, "11:00", 6, "14:00"), period(6, "17:00", 6, "22:00")]);
  if (!lunchAndDinner) throw new Error("hours");

  it("is open when the whole window is inside an open period", () => {
    expect(isOpenDuring(lunchAndDinner, at(SATURDAY, "11:00", "13:00"))).toBe(true);
    expect(isOpenDuring(lunchAndDinner, at(SATURDAY, "19:00", "22:00"))).toBe(true);
  });

  it("is closed when the window starts early, ends late, or falls in the break", () => {
    expect(isOpenDuring(lunchAndDinner, at(SATURDAY, "10:30", "12:00"))).toBe(false);
    expect(isOpenDuring(lunchAndDinner, at(SATURDAY, "21:00", "22:30"))).toBe(false);
    expect(isOpenDuring(lunchAndDinner, at(SATURDAY, "13:00", "15:00"))).toBe(false);
    expect(isOpenDuring(lunchAndDinner, at(SATURDAY, "14:30", "16:30"))).toBe(false);
  });

  it("is closed on a day with no period", () => {
    expect(isOpenDuring(lunchAndDinner, at(SUNDAY, "12:00", "13:00"))).toBe(false);
  });

  it("is never open when the list is empty, and always open when marked so", () => {
    expect(isOpenDuring({ kind: "periods", intervals: [] }, at(SATURDAY, "12:00", "13:00"))).toBe(false);
    expect(isOpenDuring({ kind: "always" }, at(SATURDAY, "03:00", "04:00"))).toBe(true);
  });

  it("covers the morning after hours that run past midnight, including past Saturday night", () => {
    const lateBar = toOpeningHours([period(6, "22:00", 0, "02:00")]);
    if (!lateBar) throw new Error("hours");
    expect(isOpenDuring(lateBar, at(SATURDAY, "22:30", "23:30"))).toBe(true);
    expect(isOpenDuring(lateBar, at(SUNDAY, "00:30", "01:30"))).toBe(true);
    expect(isOpenDuring(lateBar, at(SUNDAY, "01:00", "03:00"))).toBe(false);
  });
});

describe("namesMatch", () => {
  it("accepts the same name however it is written", () => {
    expect(namesMatch("Thip Samai", "Thip Samai")).toBe(true);
    expect(namesMatch("thip samai", "THIP SAMAI")).toBe(true);
    expect(namesMatch("Café du Monde", "Cafe du Monde")).toBe(true);
  });

  it("accepts extra words and different spacing", () => {
    expect(namesMatch("Jim Thompson House", "Jim Thompson House Museum")).toBe(true);
    expect(namesMatch("Thip Samai", "Thipsamai Pad Thai")).toBe(true);
    expect(namesMatch("Wat Pho", "Wat Pho (Temple of the Reclining Buddha)")).toBe(true);
  });

  it("rejects a different place", () => {
    expect(namesMatch("Thip Samai", "Pad Thai Fai Ta Lu")).toBe(false);
    expect(namesMatch("Wat Arun", "Wat Pho")).toBe(false);
  });

  it("does not let a very short name match inside a longer one", () => {
    expect(namesMatch("Bar", "Barcelona Tapas House")).toBe(false);
  });

  it("rejects empty names", () => {
    expect(namesMatch("", "Wat Pho")).toBe(false);
    expect(namesMatch("Wat Pho", "---")).toBe(false);
  });
});
