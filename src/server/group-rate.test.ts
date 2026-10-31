import { describe, expect, it } from "vitest";
import { GROUP_CREATION_LIMITS, groupCreationVerdict, PER_PERSON_GROUP_LIMITS, type GroupCounter } from "./group-rate";

const NOW = new Date("2026-10-28T12:00:00Z");

interface Made {
  readonly at: Date;
  readonly by: string;
}

/** A counter holding groups made at these times, each by someone. */
const counterOf = (made: Made[]): GroupCounter => ({
  createdSince: async (since) => made.filter((group) => group.at >= since).length,
  createdBySince: async (key, since) => made.filter((group) => group.by === key && group.at >= since).length,
});
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);
const many = (count: number, at: Date, by = "someone-else"): Made[] => Array.from({ length: count }, () => ({ at, by }));

describe("groupCreationVerdict, for the whole service", () => {
  it("allows a group while the hour has room, and not once it is full", async () => {
    expect(await groupCreationVerdict(counterOf(many(GROUP_CREATION_LIMITS.perHour - 1, minutesAgo(5))), NOW, null)).toBe("allowed");
    expect(await groupCreationVerdict(counterOf(many(GROUP_CREATION_LIMITS.perHour, minutesAgo(5))), NOW, null)).toBe("site_limit");
  });

  it("stops at the daily limit even when the last hour was quiet", async () => {
    expect(await groupCreationVerdict(counterOf(many(GROUP_CREATION_LIMITS.perDay, minutesAgo(180))), NOW, null)).toBe("site_limit");
  });

  it("forgets groups made more than a day ago", async () => {
    expect(await groupCreationVerdict(counterOf(many(GROUP_CREATION_LIMITS.perDay, minutesAgo(25 * 60))), NOW, null)).toBe("allowed");
  });

  it("lets a group through when the count cannot be read", async () => {
    const down: GroupCounter = { createdSince: async () => { throw new Error("down"); }, createdBySince: async () => { throw new Error("down"); } };
    expect(await groupCreationVerdict(down, NOW, "me")).toBe("allowed");
  });
});

describe("groupCreationVerdict, for one person", () => {
  it("stops one person at their hourly limit, and says it is them", async () => {
    expect(await groupCreationVerdict(counterOf(many(PER_PERSON_GROUP_LIMITS.perHour - 1, minutesAgo(5), "me")), NOW, "me")).toBe("allowed");
    expect(await groupCreationVerdict(counterOf(many(PER_PERSON_GROUP_LIMITS.perHour, minutesAgo(5), "me")), NOW, "me")).toBe("person_limit");
  });

  it("stops one person at their daily limit even when the last hour was quiet", async () => {
    expect(await groupCreationVerdict(counterOf(many(PER_PERSON_GROUP_LIMITS.perDay, minutesAgo(180), "me")), NOW, "me")).toBe("person_limit");
  });

  it("never lets one person use up the room everyone else shares", async () => {
    // A script making groups is stopped by its own limit long before the whole service's hourly limit.
    expect(PER_PERSON_GROUP_LIMITS.perHour).toBeLessThan(GROUP_CREATION_LIMITS.perHour);
    expect(await groupCreationVerdict(counterOf(many(PER_PERSON_GROUP_LIMITS.perHour, minutesAgo(5), "script")), NOW, "a-judge")).toBe("allowed");
  });

  it("holds a person whose address is not known only to the whole service's limit", async () => {
    expect(await groupCreationVerdict(counterOf(many(PER_PERSON_GROUP_LIMITS.perHour, minutesAgo(5), "anyone")), NOW, null)).toBe("allowed");
  });

  it("says the person's limit before the whole service's when both are reached", async () => {
    expect(await groupCreationVerdict(counterOf(many(GROUP_CREATION_LIMITS.perHour, minutesAgo(5), "me")), NOW, "me")).toBe("person_limit");
  });
});
