import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import { buildPlan, type BuildPlanInput } from "./build-plan";
import { ScriptedPlanner } from "./scripted-planner";
import { BANGKOK_CONSTRAINTS, BANGKOK_OFFERS, FX, MEMBERS, MEMBER_IDS, NOW, WIREFRAME_PLAN, pick, withPicks } from "./test-support";

const ALL = [...MEMBER_IDS];

const earlyFlightPlan = withPicks([
  pick("fx-flt-early", ALL),
  pick("fx-htl-triple", ["nevin", "ana", "ben"]),
  pick("fx-htl-single", ["jia"]),
]);

const input = (planner: ScriptedPlanner, overrides: Partial<BuildPlanInput> = {}): BuildPlanInput => ({
  planner,
  members: MEMBERS,
  constraints: BANGKOK_CONSTRAINTS,
  offers: BANGKOK_OFFERS,
  fx: FX,
  requiredKinds: ["flight", "hotel"],
  now: NOW,
  ...overrides,
});

describe("buildPlan", () => {
  it("accepts a plan that serves everyone on the first try and prices each person's share", async () => {
    const planner = new ScriptedPlanner({ plans: [ok(WIREFRAME_PLAN)] });
    const result = await buildPlan(input(planner));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.attempts).toBe(1);
    expect(result.value.violations).toEqual([]);
    expect(result.value.shares.map((share) => [share.memberId, share.shareMinor])).toEqual([
      ["nevin", 39500], ["ana", 39500], ["ben", 35000], ["jia", 41000],
    ]);
    expect(planner.proposeCalls[0].feedback).toEqual([]);
    expect(planner.proposeCalls[0].offers).toBe(BANGKOK_OFFERS);
  });

  it("asks again with the violations as feedback and keeps the better plan", async () => {
    const planner = new ScriptedPlanner({ plans: [ok(earlyFlightPlan), ok(WIREFRAME_PLAN)] });
    const result = await buildPlan(input(planner));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.attempts).toBe(2);
    expect(result.value.violations).toEqual([]);
    expect(planner.proposeCalls[1].feedback.join(" ")).toContain("13:05");
    expect(result.value.plan.picks.map((p) => p.offer.id)).toContain("fx-flt-evening");
  });

  it("returns the plan with the fewest violations, and reports them, when no plan serves everyone", async () => {
    const planner = new ScriptedPlanner({ plans: [ok(earlyFlightPlan)] });
    const result = await buildPlan(input(planner, { maxAttempts: 2 }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.attempts).toBe(1);
    expect(result.value.violations.map((v) => [v.memberId, v.kind])).toEqual([["ana", "departure_window"]]);
    expect(planner.proposeCalls).toHaveLength(2);
  });

  it("does not replace a better plan with a worse one", async () => {
    // Valid, but adds a second violation: Jia is put in the cooking class she said she would skip.
    const worse = withPicks([
      ...earlyFlightPlan.picks,
      pick("fx-act-cooking", ["jia", "ben"]),
    ]);
    const planner = new ScriptedPlanner({ plans: [ok(earlyFlightPlan), ok(worse), ok(worse)] });
    const result = await buildPlan(input(planner));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.violations).toHaveLength(1);
    expect(result.value.attempts).toBe(1);
  });

  it("feeds a validation error back and recovers", async () => {
    const invented = withPicks([pick("made-up", ALL)]);
    const planner = new ScriptedPlanner({ plans: [ok(invented), ok(WIREFRAME_PLAN)] });
    const result = await buildPlan(input(planner));
    expect(result.ok && result.value.attempts).toBe(2);
    expect(planner.proposeCalls[1].feedback.join(" ")).toContain("do not exist");
  });

  it("retries when the planner's output was malformed", async () => {
    const planner = new ScriptedPlanner({
      plans: [err({ code: "invalid_output", message: "Planner output is not valid JSON" }), ok(WIREFRAME_PLAN)],
    });
    const result = await buildPlan(input(planner));
    expect(result.ok && result.value.attempts).toBe(2);
    expect(planner.proposeCalls[1].feedback).toEqual(["Planner output is not valid JSON"]);
  });

  it("gives up with the last problem after the allowed attempts", async () => {
    const planner = new ScriptedPlanner({ plans: [ok(withPicks([pick("made-up", ALL)]))] });
    const result = await buildPlan(input(planner, { maxAttempts: 2 }));
    expect(result).toMatchObject({ ok: false, error: { code: "no_valid_plan" } });
    expect(planner.proposeCalls).toHaveLength(2);
  });

  it("stops at once when the planner is unavailable", async () => {
    const planner = new ScriptedPlanner({ plans: [err({ code: "planner_unavailable", message: "Muse is down" })] });
    const result = await buildPlan(input(planner));
    expect(result).toEqual({ ok: false, error: { code: "planner_unavailable", message: "Muse is down" } });
    expect(planner.proposeCalls).toHaveLength(1);
  });

  it("reports a split it cannot price, such as a member whose currency has no rate", async () => {
    const planner = new ScriptedPlanner({ plans: [ok(WIREFRAME_PLAN)] });
    const members = MEMBERS.map((member) => (member.id === "ben" ? { ...member, currency: "EUR" } : member));
    const result = await buildPlan(input(planner, { members }));
    expect(result).toMatchObject({ ok: false, error: { code: "split_failed" } });
  });

  it("makes at least one attempt by default and at most three", async () => {
    const planner = new ScriptedPlanner({ plans: [ok(withPicks([pick("made-up", ALL)]))] });
    await buildPlan(input(planner));
    expect(planner.proposeCalls).toHaveLength(3);
  });
});

describe("ScriptedPlanner", () => {
  it("returns empty constraints by default and records what it was asked", async () => {
    const planner = new ScriptedPlanner({ plans: [] });
    const messages = [{ memberId: "ana", text: "I can only fly after 6pm" }];
    expect(await planner.extractConstraints({ memberIds: ["ana"], messages })).toEqual({ ok: true, value: {} });
    expect(planner.extractCalls[0].messages).toEqual(messages);
  });

  it("reports unavailable when it has no answers left to give", async () => {
    const planner = new ScriptedPlanner({ plans: [] });
    const result = await planner.proposePlan({ memberIds: [], constraints: {}, offers: [], feedback: [] });
    expect(result.ok ? null : result.error.code).toBe("planner_unavailable");
  });
});
