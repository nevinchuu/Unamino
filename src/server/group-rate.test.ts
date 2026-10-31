import { describe, expect, it } from "vitest";
import { DEMO_START_LIMITS, demoStartVerdict, GROUP_CREATION_LIMITS, groupCreationVerdict, PER_PERSON_DEMO_LIMITS, PER_PERSON_GROUP_LIMITS, type GroupCounter } from "./group-rate";

const NOW = new Date("2026-10-28T12:00:00Z");

interface Made {
  readonly at: Date;
  readonly by: string;
  readonly name?: string;
}

const matches = (group: Made, names?: readonly string[]): boolean => names === undefined || (group.name !== undefined && names.includes(group.name));

/** A counter holding groups made at these times, each by someone. */
const counterOf = (made: Made[]): GroupCounter => ({
  createdSince: async (since, names) => made.filter((group) => group.at >= since && matches(group, names)).length,
  createdBySince: async (key, since, names) => made.filter((group) => group.by === key && group.at >= since && matches(group, names)).length,
});
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);
const many = (count: number, at: Date, by = "someone-else", name?: string): Made[] => Array.from({ length: count }, () => ({ at, by, ...(name && { name }) }));

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

describe("demoStartVerdict", () => {
  const NAMES = ["Bangkok demo", "Bangkok demo (booking fails)"] as const;
  const demos = (count: number, at: Date, by: string, name: string = NAMES[0]) => many(count, at, by, name);

  it("stops one person at their own, lower limit for demos, and says it is them", async () => {
    expect(await demoStartVerdict(counterOf(demos(PER_PERSON_DEMO_LIMITS.perHour - 1, minutesAgo(5), "me")), NOW, "me", NAMES)).toBe("allowed");
    expect(await demoStartVerdict(counterOf(demos(PER_PERSON_DEMO_LIMITS.perHour, minutesAgo(5), "me")), NOW, "me", NAMES)).toBe("person_limit");
  });

  it("counts both demo buttons together, and stops at the daily limit even when the last hour was quiet", async () => {
    const both = [...demos(1, minutesAgo(5), "me", NAMES[0]), ...demos(1, minutesAgo(5), "me", NAMES[1])];
    expect(await demoStartVerdict(counterOf(both), NOW, "me", NAMES)).toBe("person_limit");
    expect(await demoStartVerdict(counterOf(demos(PER_PERSON_DEMO_LIMITS.perDay, minutesAgo(180), "me")), NOW, "me", NAMES)).toBe("person_limit");
  });

  it("does not count ordinary groups, so making groups never uses up the demo", async () => {
    expect(await demoStartVerdict(counterOf(many(PER_PERSON_GROUP_LIMITS.perHour, minutesAgo(5), "me", "Japan trip")), NOW, "me", NAMES)).toBe("allowed");
  });

  it("stops the whole service at its demo limit without blaming the person", async () => {
    expect(await demoStartVerdict(counterOf(demos(DEMO_START_LIMITS.perHour, minutesAgo(5), "someone-else")), NOW, "me", NAMES)).toBe("site_limit");
    expect(await demoStartVerdict(counterOf(demos(DEMO_START_LIMITS.perDay, minutesAgo(180), "someone-else")), NOW, null, NAMES)).toBe("site_limit");
  });

  it("forgets demos started more than a day ago, and lets one through when the count cannot be read", async () => {
    expect(await demoStartVerdict(counterOf(demos(PER_PERSON_DEMO_LIMITS.perDay, minutesAgo(25 * 60), "me")), NOW, "me", NAMES)).toBe("allowed");
    const down: GroupCounter = { createdSince: async () => { throw new Error("down"); }, createdBySince: async () => { throw new Error("down"); } };
    expect(await demoStartVerdict(down, NOW, "me", NAMES)).toBe("allowed");
  });
});
