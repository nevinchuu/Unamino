import { describe, expect, it } from "vitest";
import { PLAN_STATUSES } from "@/domain/plan/statuses";
import type { CardPerson, CardPlan } from "./plan-card";
import { latestPlan, previewOf, relativeTime, tripStatus } from "./trip-list";

const NOW = new Date("2026-10-28T12:00:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it.each([
    [0, "now"],
    [59_000, "now"],
    [5 * MINUTE, "5m"],
    [59 * MINUTE, "59m"],
    [3 * HOUR, "3h"],
    [2 * DAY, "2d"],
    [6 * DAY, "6d"],
    [7 * DAY, "1w"],
    [20 * DAY, "2w"],
  ])("says %d ms ago as %j", (ms, expected) => {
    expect(relativeTime(ago(ms), NOW)).toBe(expected);
  });

  it("calls a time slightly in the future now, so a fast clock never shows a negative", () => {
    expect(relativeTime(ago(-30_000), NOW)).toBe("now");
  });
});

describe("previewOf", () => {
  it("signs a person's message with their name, or You for the viewer's own", () => {
    expect(previewOf({ kind: "human", senderName: "Ana", mine: false, body: "see you at 8" })).toBe("Ana: see you at 8");
    expect(previewOf({ kind: "human", senderName: "Ana", mine: true, body: "see you at 8" })).toBe("You: see you at 8");
  });

  it("names the agent, and leaves a system line unsigned", () => {
    expect(previewOf({ kind: "agent", senderName: "Trippy", mine: false, body: "Found a plan" })).toBe("Trippy: Found a plan");
    expect(previewOf({ kind: "system", senderName: null, mine: false, body: "Everyone agreed to the plan" })).toBe("Everyone agreed to the plan");
  });

  it("keeps to the first line and cuts a long one", () => {
    expect(previewOf({ kind: "human", senderName: "Ben", mine: false, body: "first\nsecond" })).toBe("Ben: first…");
    expect(previewOf({ kind: "human", senderName: "Ben", mine: false, body: "x".repeat(200) }).length).toBeLessThan(100);
  });
});

const plan = (overrides: Partial<CardPlan> = {}): CardPlan => ({ id: "p1", title: "Bangkok", status: "reviewing", headcount: 4, agreedCount: 2, replacedById: null, deadlineAt: "2026-12-01T10:00:00.000Z", ...overrides });
const person = (name: string, overrides: Partial<CardPerson> = {}): CardPerson => ({ name, isMe: false, agreed: false, approved: false, held: false, ...overrides });

describe("latestPlan", () => {
  it("is the newest plan that no later plan took over from", () => {
    const plans = [plan({ id: "p1", replacedById: "p2" }), plan({ id: "p2" })];
    expect(latestPlan(plans)?.id).toBe("p2");
  });

  it("is null for a group with no plan", () => {
    expect(latestPlan([])).toBeNull();
  });
});

describe("tripStatus", () => {
  it("has no chip before there is a plan", () => {
    expect(tripStatus(null, [])).toBeNull();
  });

  it("counts agreements while the plan is being agreed to", () => {
    expect(tripStatus(plan(), [])).toEqual({ label: "2 of 4 agreed", tone: "success" });
  });

  it("counts card holds once amounts are being approved", () => {
    expect(tripStatus(plan({ status: "approving" }), [person("Ana", { held: true }), person("Ben")])).toEqual({ label: "Holds 1 of 4", tone: "pending" });
  });

  it("calls a paid trip booked, and an ended plan ended", () => {
    expect(tripStatus(plan({ status: "captured" }), [])).toEqual({ label: "Booked", tone: "solid" });
    expect(tripStatus(plan({ status: "expired" }), [])).toEqual({ label: "Plan ended", tone: "neutral" });
  });

  it("has a chip for every state a plan can be in", () => {
    for (const status of PLAN_STATUSES) expect(tripStatus(plan({ status }), [])?.label.length, status).toBeGreaterThan(3);
  });
});
