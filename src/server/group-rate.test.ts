import { describe, expect, it } from "vitest";
import { GROUP_CREATION_LIMITS, groupCreationAllowed, type GroupCounter } from "./group-rate";

const NOW = new Date("2026-10-28T12:00:00Z");

/** A counter holding groups made at these times. */
const counterOf = (times: Date[]): GroupCounter => ({ createdSince: async (since) => times.filter((time) => time >= since).length });
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);
const many = (count: number, at: Date): Date[] => Array.from({ length: count }, () => at);

describe("groupCreationAllowed", () => {
  it("allows a group while the hour has room, and not once it is full", async () => {
    expect(await groupCreationAllowed(counterOf(many(GROUP_CREATION_LIMITS.perHour - 1, minutesAgo(5))), NOW)).toBe(true);
    expect(await groupCreationAllowed(counterOf(many(GROUP_CREATION_LIMITS.perHour, minutesAgo(5))), NOW)).toBe(false);
  });

  it("stops at the daily limit even when the last hour was quiet", async () => {
    expect(await groupCreationAllowed(counterOf(many(GROUP_CREATION_LIMITS.perDay, minutesAgo(180))), NOW)).toBe(false);
  });

  it("forgets groups made more than a day ago", async () => {
    expect(await groupCreationAllowed(counterOf(many(GROUP_CREATION_LIMITS.perDay, minutesAgo(25 * 60))), NOW)).toBe(true);
  });

  it("lets a group through when the count cannot be read", async () => {
    expect(await groupCreationAllowed({ createdSince: async () => { throw new Error("down"); } }, NOW)).toBe(true);
  });
});
