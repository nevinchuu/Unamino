import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import { ScriptedPlanner } from "@/domain/planner/scripted-planner";
import { BANGKOK_CONSTRAINTS, MEMBER_IDS, NOW } from "@/domain/planner/test-support";
import { buildSchedule } from "./build-schedule";
import type { Suggestion } from "./suggestion-schema";
import { suggestFreeTime } from "./suggest-free-time";
import { BANGKOK_GAP_IDS, FakeVenueLookup, openDaily, venue, wireframePlan } from "./test-support";
import { verifySuggestion, type VerifyContext } from "./verify-suggestion";

const schedule = buildSchedule(wireframePlan());
if (!schedule.ok) throw new Error(schedule.error.message);
const GAPS = schedule.value.gaps;
const [LUNCH, SATURDAY_EVENING, SUNDAY] = BANGKOK_GAP_IDS;

const dinner: Suggestion = { gapId: SATURDAY_EVENING, venueName: "Thip Samai", category: "meal", startTime: "18:00", durationMinutes: 90, why: "Famous pad thai near the hotel" };
const lunch: Suggestion = { gapId: LUNCH, venueName: "Err Urban Rustic Thai", category: "meal", startTime: "12:30", durationMinutes: 60, why: "A quick lunch before the afternoon" };

const context = (lookup: FakeVenueLookup, overrides: Partial<VerifyContext> = {}): VerifyContext => ({
  gaps: GAPS,
  memberIds: MEMBER_IDS,
  constraints: BANGKOK_CONSTRAINTS,
  city: "Bangkok",
  lookup,
  taken: { placeIds: new Set(), windows: [] },
  now: NOW,
  ...overrides,
});

const codeOf = async (suggestion: Suggestion, lookup: FakeVenueLookup, overrides: Partial<VerifyContext> = {}) => {
  const result = await verifySuggestion(suggestion, context(lookup, overrides));
  return result.ok ? null : result.error.code;
};

describe("verifySuggestion: a good suggestion", () => {
  it("is accepted, with the venue's facts taken from the lookup and not from the planner", async () => {
    const lookup = new FakeVenueLookup([venue("Thip Samai Pad Thai", { address: "313 Mahachai Rd", hours: openDaily(10, 22) })]);
    const result = await verifySuggestion(dinner, context(lookup));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      gapId: SATURDAY_EVENING, date: "2026-12-12", startTime: "18:00", endTime: "19:30", durationMinutes: 90,
      why: "Famous pad thai near the hotel", checkedAt: NOW.toISOString(),
      venue: { name: "Thip Samai Pad Thai", address: "313 Mahachai Rd", businessStatus: "operational" },
    });
    expect(lookup.queries).toEqual([{ name: "Thip Samai", city: "Bangkok" }]);
  });
});

describe("verifySuggestion: the slot", () => {
  const lookup = () => new FakeVenueLookup([venue("Thip Samai")]);

  it("rejects a gap that does not exist, without calling the lookup", async () => {
    const fake = lookup();
    expect(await codeOf({ ...dinner, gapId: "gap-nope" }, fake)).toBe("unknown_gap");
    expect(fake.queries).toEqual([]);
  });

  it("rejects a time that starts before the gap, or runs past it", async () => {
    expect(await codeOf({ ...dinner, startTime: "17:00" }, lookup())).toBe("outside_gap");
    expect(await codeOf({ ...dinner, startTime: "21:00", durationMinutes: 90 }, lookup())).toBe("outside_gap");
  });

  it("accepts a time that ends exactly when the gap ends", async () => {
    expect(await codeOf({ ...dinner, startTime: "20:30", durationMinutes: 90 }, lookup())).toBeNull();
  });

  it("rejects what a member said they would skip", async () => {
    const result = await verifySuggestion({ ...dinner, category: "cooking" }, context(lookup()));
    expect(result.ok ? null : result.error).toMatchObject({ code: "member_conflict" });
    expect(!result.ok && result.error.message).toContain("jia");
  });

  it("rejects a time that overlaps an earlier suggestion that day", async () => {
    const taken = { placeIds: new Set<string>(), windows: [{ date: "2026-12-12", start: 18 * 60 + 30, end: 20 * 60 }] };
    expect(await codeOf(dinner, lookup(), { taken })).toBe("overlaps_other");
  });
});

describe("verifySuggestion: the place", () => {
  it("rejects a place that was not found", async () => {
    expect(await codeOf(dinner, new FakeVenueLookup([]))).toBe("not_found");
  });

  it("rejects a different place that happened to come back", async () => {
    const result = await verifySuggestion(dinner, context(new FakeVenueLookup([venue("Pad Thai Fai Ta Lu")])));
    expect(result.ok ? null : result.error).toMatchObject({ code: "name_mismatch" });
    expect(!result.ok && result.error.message).toContain("Pad Thai Fai Ta Lu");
  });

  it("rejects a place that has closed, permanently or for now", async () => {
    expect(await codeOf(dinner, new FakeVenueLookup([venue("Thip Samai", { businessStatus: "closed_permanently" })]))).toBe("closed_permanently");
    expect(await codeOf(dinner, new FakeVenueLookup([venue("Thip Samai", { businessStatus: "closed_temporarily" })]))).toBe("closed_temporarily");
  });

  it("drops a place with no opening hours listed, because it cannot be confirmed", async () => {
    expect(await codeOf(dinner, new FakeVenueLookup([venue("Thip Samai", { hours: null })]))).toBe("no_hours");
  });

  it("rejects a place that is closed at that time and says which day", async () => {
    const lookup = new FakeVenueLookup([venue("Thip Samai", { hours: openDaily(10, 17) })]);
    const result = await verifySuggestion(dinner, context(lookup));
    expect(result.ok ? null : result.error).toMatchObject({ code: "closed_then" });
    expect(!result.ok && result.error.message).toContain("Saturdays");
  });

  it("rejects a place already suggested", async () => {
    const lookup = new FakeVenueLookup([venue("Thip Samai")]);
    const taken = { placeIds: new Set(["place-thip-samai"]), windows: [] };
    expect(await codeOf(dinner, lookup, { taken })).toBe("duplicate_venue");
  });

  it("reports a lookup outage as unverifiable", async () => {
    const lookup = new FakeVenueLookup([], { code: "lookup_unavailable", message: "Google Places did not respond in time" });
    const result = await verifySuggestion(dinner, context(lookup));
    expect(result.ok ? null : result.error).toMatchObject({ code: "lookup_unavailable" });
    expect(!result.ok && result.error.message).toContain("did not respond");
  });
});

describe("suggestFreeTime", () => {
  const both = ok({ suggestions: [dinner, lunch] });
  const places = [venue("Thip Samai"), venue("Err Urban Rustic Thai")];
  const request = (planner: ScriptedPlanner, lookup: FakeVenueLookup, extra: object = {}) => ({
    planner, lookup, gaps: GAPS, memberIds: MEMBER_IDS, constraints: BANGKOK_CONSTRAINTS, city: "Bangkok", now: NOW, ...extra,
  });

  it("keeps confirmed places on the first try", async () => {
    const planner = new ScriptedPlanner({ plans: [], suggestions: [both] });
    const result = await suggestFreeTime(request(planner, new FakeVenueLookup(places)));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.attempts).toBe(1);
    expect(result.value.verified.map((item) => item.venue.name)).toEqual(["Thip Samai", "Err Urban Rustic Thai"]);
    expect(result.value.rejected).toEqual([]);
    expect(planner.suggestCalls[0]).toMatchObject({ city: "Bangkok", gaps: GAPS, feedback: [] });
  });

  it("tells the planner why a place was rejected and keeps the replacement", async () => {
    const closed = { ...dinner, venueName: "Closed Cafe" };
    const planner = new ScriptedPlanner({ plans: [], suggestions: [ok({ suggestions: [closed] }), ok({ suggestions: [dinner] })] });
    const lookup = new FakeVenueLookup([venue("Closed Cafe", { hours: openDaily(10, 17) }), venue("Thip Samai")]);
    const result = await suggestFreeTime(request(planner, lookup));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.attempts).toBe(2);
    expect(result.value.verified.map((item) => item.venue.name)).toEqual(["Thip Samai"]);
    expect(result.value.rejected).toEqual([]);
    expect(planner.suggestCalls[1].feedback.join(" ")).toMatch(/"Closed Cafe".*was rejected.*not open/);
  });

  it("keeps earlier confirmed places and refuses the same place twice", async () => {
    // The first answer has one bad suggestion, which triggers a second attempt that suggests the same place
    // again on Sunday. Repeating the same slot would be caught as an overlap instead.
    const flawed = ok({ suggestions: [dinner, { ...lunch, gapId: "gap-nope" }] });
    const again = { ...dinner, gapId: SUNDAY, startTime: "11:00" };
    const planner = new ScriptedPlanner({ plans: [], suggestions: [flawed, ok({ suggestions: [again] })] });
    const result = await suggestFreeTime(request(planner, new FakeVenueLookup(places)));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.verified).toHaveLength(1);
    expect(result.value.rejected.map((item) => item.code)).toEqual(["duplicate_venue"]);
    expect(result.value.attempts).toBe(2);
  });

  it("does not retry because of a lookup outage, and shows nothing unconfirmed", async () => {
    const planner = new ScriptedPlanner({ plans: [], suggestions: [both] });
    const lookup = new FakeVenueLookup([], { code: "lookup_unavailable", message: "down" });
    const result = await suggestFreeTime(request(planner, lookup));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.verified).toEqual([]);
    expect(result.value.rejected.map((item) => item.code)).toEqual(["lookup_unavailable", "lookup_unavailable"]);
    expect(result.value.attempts).toBe(1);
  });

  it("stops after the allowed attempts", async () => {
    const planner = new ScriptedPlanner({ plans: [], suggestions: [ok({ suggestions: [{ ...dinner, gapId: "gap-nope" }] })] });
    const result = await suggestFreeTime(request(planner, new FakeVenueLookup(places), { maxAttempts: 3 }));
    expect(result.ok && result.value.attempts).toBe(3);
    expect(planner.suggestCalls).toHaveLength(3);
  });

  it("retries when the planner's output was malformed", async () => {
    const planner = new ScriptedPlanner({ plans: [], suggestions: [err({ code: "invalid_output", message: "Suggestion output is not valid JSON" }), ok({ suggestions: [dinner] })] });
    const result = await suggestFreeTime(request(planner, new FakeVenueLookup(places)));
    expect(result.ok && result.value.verified).toHaveLength(1);
    expect(planner.suggestCalls[1].feedback).toEqual(["Suggestion output is not valid JSON"]);
  });

  it("stops at once when the planner is unavailable", async () => {
    const planner = new ScriptedPlanner({ plans: [], suggestions: [err({ code: "planner_unavailable", message: "Muse is down" })] });
    const result = await suggestFreeTime(request(planner, new FakeVenueLookup(places)));
    expect(result).toEqual({ ok: false, error: { code: "planner_unavailable", message: "Muse is down" } });
  });

  it("does not ask when there is no free time", async () => {
    const planner = new ScriptedPlanner({ plans: [] });
    const result = await suggestFreeTime({ ...request(planner, new FakeVenueLookup(places)), gaps: [] });
    expect(result).toEqual({ ok: true, value: { verified: [], rejected: [], attempts: 0 } });
    expect(planner.suggestCalls).toEqual([]);
  });

  it("can fill the Sunday gap too", async () => {
    const sunday: Suggestion = { ...dinner, gapId: SUNDAY, venueName: "Err Urban Rustic Thai", startTime: "11:00", category: "meal" };
    const planner = new ScriptedPlanner({ plans: [], suggestions: [ok({ suggestions: [sunday] })] });
    const result = await suggestFreeTime(request(planner, new FakeVenueLookup(places)));
    expect(result.ok && result.value.verified[0]).toMatchObject({ date: "2026-12-13", startTime: "11:00", endTime: "12:30" });
  });
});
