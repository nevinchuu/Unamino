import { describe, expect, it } from "vitest";
import { clockTime, continuesRun, dayKey, dayLabel, layoutMessages, SAME_SENDER_GAP_MS, snippet, type Placed } from "./chat-format";

const SG = "Asia/Singapore";
const NEW_YORK = "America/New_York";
const at = (iso: string) => new Date(iso);

describe("clockTime", () => {
  it("shows the time on the reader's clock, 24 hour, with a leading zero", () => {
    expect(clockTime(at("2026-10-27T06:05:00Z"), "UTC")).toBe("06:05");
    expect(clockTime(at("2026-10-27T06:05:00Z"), SG)).toBe("14:05");
    expect(clockTime(at("2026-10-27T16:30:00Z"), NEW_YORK)).toBe("12:30");
  });

  it("writes midnight as 00:00, never 24:00", () => {
    expect(clockTime(at("2026-10-26T16:00:00Z"), SG)).toBe("00:00");
  });
});

describe("dayKey", () => {
  it("is the reader's calendar day, so the same moment is a different day in different places", () => {
    expect(dayKey(at("2026-10-27T20:00:00Z"), "UTC")).toBe("2026-10-27");
    expect(dayKey(at("2026-10-27T20:00:00Z"), SG)).toBe("2026-10-28");
  });
});

describe("dayLabel", () => {
  const now = at("2026-10-27T04:00:00Z");

  it("says Today and Yesterday by the reader's calendar, not by 24 hours", () => {
    expect(dayLabel(at("2026-10-27T00:10:00Z"), now, "UTC")).toBe("Today");
    // 23:50 the night before is 1 hour 10 minutes earlier, and still yesterday.
    expect(dayLabel(at("2026-10-26T23:50:00Z"), now, "UTC")).toBe("Yesterday");
  });

  it("names older days with the weekday and date", () => {
    expect(dayLabel(at("2026-10-23T12:00:00Z"), now, "UTC")).toBe("Fri 23 Oct");
    expect(dayLabel(at("2025-12-11T12:00:00Z"), now, "UTC")).toBe("Thu 11 Dec");
  });

  it("counts calendar days across a clock change", () => {
    // New York ended daylight saving on 1 November 2026, so that day has 25 hours.
    const afterChange = at("2026-11-02T17:00:00Z");
    expect(dayLabel(at("2026-11-01T17:00:00Z"), afterChange, NEW_YORK)).toBe("Yesterday");
    expect(dayLabel(at("2026-10-31T17:00:00Z"), afterChange, NEW_YORK)).toBe("Sat 31 Oct");
  });
});

describe("continuesRun", () => {
  const ana = (iso: string): Placed => ({ kind: "human", senderId: "ana", at: at(iso) });

  it("carries on for the same person within a few minutes", () => {
    expect(continuesRun(ana("2026-10-27T10:00:00Z"), ana("2026-10-27T10:04:00Z"), "UTC")).toBe(true);
  });

  it("starts over after a long pause, exactly at the limit still counting", () => {
    const first = ana("2026-10-27T10:00:00Z");
    expect(continuesRun(first, { ...first, at: new Date(first.at.getTime() + SAME_SENDER_GAP_MS) }, "UTC")).toBe(true);
    expect(continuesRun(first, { ...first, at: new Date(first.at.getTime() + SAME_SENDER_GAP_MS + 1) }, "UTC")).toBe(false);
  });

  it("starts over for a different person, the first message, and across midnight", () => {
    expect(continuesRun(ana("2026-10-27T10:00:00Z"), { kind: "human", senderId: "ben", at: at("2026-10-27T10:01:00Z") }, "UTC")).toBe(false);
    expect(continuesRun(null, ana("2026-10-27T10:00:00Z"), "UTC")).toBe(false);
    expect(continuesRun(ana("2026-10-27T23:59:00Z"), ana("2026-10-28T00:01:00Z"), "UTC")).toBe(false);
  });

  it("never merges the agent with a person, or anything with a system line", () => {
    const agent: Placed = { kind: "agent", senderId: null, at: at("2026-10-27T10:00:00Z") };
    expect(continuesRun(agent, { ...agent, at: at("2026-10-27T10:01:00Z") }, "UTC")).toBe(true);
    expect(continuesRun(agent, ana("2026-10-27T10:01:00Z"), "UTC")).toBe(false);
    const system: Placed = { kind: "system", senderId: null, at: at("2026-10-27T10:00:00Z") };
    expect(continuesRun(system, { ...system, at: at("2026-10-27T10:01:00Z") }, "UTC")).toBe(false);
  });
});

describe("snippet", () => {
  it("leaves a short one-line message alone", () => {
    expect(snippet("Singapore, leaving Friday")).toBe("Singapore, leaving Friday");
  });

  it("keeps only the first line, and shows that there was more", () => {
    expect(snippet("I need one more thing:\n1. dates\n2. airport")).toBe("I need one more thing:\u2026");
  });

  it("cuts a long line to the limit with an ellipsis, without splitting an emoji", () => {
    expect(snippet("x".repeat(100), 10)).toBe("xxxxxxxxxx\u2026");
    expect(snippet("\u{1F334}".repeat(5), 3)).toBe("\u{1F334}\u{1F334}\u{1F334}\u2026");
  });

  it("ignores blank lines and spaces around the message", () => {
    expect(snippet("\n\n  hello  \n")).toBe("hello");
  });
});

describe("layoutMessages", () => {
  const msg = (iso: string, senderId = "ana"): Placed => ({ kind: "human", senderId, at: at(iso) });
  const now = at("2026-10-27T12:00:00Z");

  it("puts a day divider before the first message of each day, and a name on each new run", () => {
    const laid = layoutMessages([msg("2026-10-26T10:00:00Z"), msg("2026-10-26T10:01:00Z"), msg("2026-10-27T09:00:00Z"), msg("2026-10-27T09:01:00Z", "ben")], now, "UTC");
    expect(laid.map((l) => l.dayLabel)).toEqual(["Yesterday", null, "Today", null]);
    expect(laid.map((l) => l.startsRun)).toEqual([true, false, true, true]);
  });

  it("handles an empty chat and a single message", () => {
    expect(layoutMessages([], now, "UTC")).toEqual([]);
    expect(layoutMessages([msg("2026-10-27T09:00:00Z")], now, "UTC")).toMatchObject([{ dayLabel: "Today", startsRun: true }]);
  });

  it("keeps the messages themselves, in order", () => {
    const items = [msg("2026-10-27T09:00:00Z"), msg("2026-10-27T09:01:00Z")];
    expect(layoutMessages(items, now, "UTC").map((l) => l.item)).toEqual(items);
  });
});
