import { describe, expect, it } from "vitest";
import { ok } from "@/lib/result";
import type { Planner } from "@/domain/planner/planner";
import { ScriptedPlanner } from "@/domain/planner/scripted-planner";
import type { MemberShare } from "@/domain/split/types";
import { AliasingPlanner, nameMembers } from "./aliasing-planner";
import { planAnnouncement, questionsMessage, shortDate, statusMessage } from "./announce";
import { computeInputsHash } from "./inputs-hash";
import { StaticFxRates } from "./static-fx";
import { BANGKOK_TRIP } from "./test-support";

// Real ids look like these: long and meaningless.
const ANA = "3f2c9a1e-7b44-4c0e-9d11-0a5b6c7d8e9f";
const BEN = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const MEMBER_IDS = [ANA, BEN];

describe("showing the model stand-ins for member ids", () => {
  const scripted = new ScriptedPlanner({
    constraints: ok({ m1: { ownRoom: true }, m2: { budgetCap: { amountMinor: 35000, currency: "USD" } }, m9: { ownRoom: true } }),
    plans: [ok({ title: "t", picks: [{ offerId: "o1", reason: "r", members: [{ memberId: "m1", note: "n" }, { memberId: "m2", note: "n" }] }], compromises: [{ memberId: "m2", note: "c" }] })],
  });
  const planner: Planner = new AliasingPlanner(scripted, MEMBER_IDS);

  it("turns real ids into m1, m2 in what the model is asked, and back in what it answers", async () => {
    const constraints = await planner.extractConstraints({ memberIds: MEMBER_IDS, messages: [{ memberId: BEN, text: "hello" }] });
    expect(scripted.extractCalls[0]).toMatchObject({ memberIds: ["m1", "m2"], messages: [{ memberId: "m2", text: "hello" }] });
    // m9 is nobody, so it is dropped.
    expect(constraints.ok && Object.keys(constraints.value).sort()).toEqual([ANA, BEN].sort());
    expect(constraints.ok && constraints.value[ANA]).toEqual({ ownRoom: true });
  });

  it("does the same for constraints, picks and compromises when proposing a plan", async () => {
    const result = await planner.proposePlan({ memberIds: MEMBER_IDS, constraints: { [ANA]: { ownRoom: true } }, offers: [], feedback: [] });
    expect(scripted.proposeCalls[0].constraints).toEqual({ m1: { ownRoom: true } });
    expect(result.ok && result.value.picks[0].members.map((m) => m.memberId)).toEqual([ANA, BEN]);
    expect(result.ok && result.value.compromises?.[0].memberId).toBe(BEN);
  });

  it("replaces real ids inside the feedback it passes on, so they do not leak through the text", async () => {
    await planner.proposePlan({ memberIds: MEMBER_IDS, constraints: {}, offers: [], feedback: [`${ANA} wants the outbound flight after 18:00, but it leaves at 13:05`, `${BEN}'s share is over budget`] });
    expect(scripted.proposeCalls.at(-1)?.feedback).toEqual(["m1 wants the outbound flight after 18:00, but it leaves at 13:05", "m2's share is over budget"]);
  });

  it("aliases the people in free-time requests too", async () => {
    await planner.suggestFreeTime({ city: "Bangkok", memberIds: MEMBER_IDS, constraints: { [BEN]: { ownRoom: false } }, gaps: [], feedback: [`${ANA} dislikes it`] });
    expect(scripted.suggestCalls[0]).toMatchObject({ memberIds: ["m1", "m2"], constraints: { m2: { ownRoom: false } }, feedback: ["m1 dislikes it"] });
  });

  it("passes the trip brief through with aliased messages and no ids in its answer to map", async () => {
    await planner.extractTripBrief({ memberIds: MEMBER_IDS, messages: [{ memberId: ANA, text: "Bangkok please" }], today: "2026-10-27" });
    expect(scripted.briefCalls[0].messages).toEqual([{ memberId: "m1", text: "Bangkok please" }]);
  });

  it("does not touch a short id that happens to sit inside a longer word", () => {
    const people = [{ id: "ana", displayName: "Ana" }];
    expect(nameMembers("ana wants a banana, and ana-2 is someone else", people)).toBe("Ana wants a banana, and ana-2 is someone else");
  });
});

describe("the fingerprint of what a plan was built from", () => {
  const trip = BANGKOK_TRIP;
  const base = { trip, memberIds: [ANA, BEN], constraints: { [ANA]: { ownRoom: true } } };

  it("is the same for the same inputs, whatever order they come in", () => {
    const shuffled = { trip: { ...trip }, memberIds: [BEN, ANA], constraints: { [ANA]: { ownRoom: true } } };
    expect(computeInputsHash(shuffled)).toBe(computeInputsHash(base));
  });

  it("treats someone who said nothing the same as someone with no constraints", () => {
    expect(computeInputsHash({ ...base, constraints: { [ANA]: { ownRoom: true }, [BEN]: {} } })).toBe(computeInputsHash(base));
  });

  it("changes when the trip, the people or anyone's constraints change", () => {
    const hash = computeInputsHash(base);
    expect(computeInputsHash({ ...base, trip: { ...trip, departDate: "2026-12-18" } })).not.toBe(hash);
    expect(computeInputsHash({ ...base, trip: { ...trip, destinationAirport: "DMK" } })).not.toBe(hash);
    expect(computeInputsHash({ ...base, memberIds: [ANA, BEN, "newcomer"] })).not.toBe(hash);
    expect(computeInputsHash({ ...base, constraints: { [ANA]: { ownRoom: true }, [BEN]: { budgetCap: { amountMinor: 1, currency: "USD" } } } })).not.toBe(hash);
  });

  it("ignores constraints of people who are not in the plan", () => {
    expect(computeInputsHash({ ...base, constraints: { ...base.constraints, stranger: { ownRoom: true } } })).toBe(computeInputsHash(base));
  });
});

describe("what the agent says", () => {
  const members = [{ id: ANA, displayName: "Ana" }, { id: BEN, displayName: "Ben" }];
  const shares: MemberShare[] = [
    { memberId: ANA, currency: "USD", lines: [], baseShareMinor: 32000, shareMinor: 32000, fxRate: 1, fxSource: "x" },
    { memberId: BEN, currency: "SGD", lines: [], baseShareMinor: 32000, shareMinor: 43200, fxRate: 1.35, fxSource: "x" },
  ];
  const input = { trip: BANGKOK_TRIP, members, shares, totalMinor: 64000, currency: "USD", violations: [], replacedAnotherPlan: false };

  it("writes dates the way people say them", () => {
    expect(shortDate("2026-12-11")).toBe("Fri 11 Dec");
    expect(shortDate("2027-01-03")).toBe("Sun 3 Jan");
  });

  it("announces a plan with the total and each person's share in their own currency", () => {
    const text = planAnnouncement(input);
    expect(text).toContain("Here is a plan for Bangkok, Fri 11 Dec to Sun 13 Dec, for 2 people. The trip costs $640.00 in total.");
    expect(text).toContain("• Ana: $320.00");
    expect(text).toContain("• Ben: SGD");
    expect(text).not.toContain("Not fully served");
  });

  it("names the people who are not fully served instead of showing ids", () => {
    const text = planAnnouncement({ ...input, violations: [{ memberId: ANA, kind: "departure_window", message: `${ANA} wants the outbound flight after 18:00, but it leaves at 13:05` }] });
    expect(text).toContain("Not fully served:\n• Ana wants the outbound flight after 18:00");
    expect(text).not.toContain(ANA);
  });

  it("says when a plan replaces another", () => {
    const text = planAnnouncement({ ...input, replacedAnotherPlan: true });
    expect(text).toContain("Here is an updated plan");
    expect(text).toContain("The earlier plan is cancelled");
  });

  it("says one question or several, and how to answer", () => {
    expect(questionsMessage(["Which dates?"])).toBe("I need one more thing before I can plan: Which dates?");
    expect(questionsMessage(["A?", "B?"])).toBe("I need a bit more information before I can plan:\n1. A?\n2. B?\nReply to this message with the answers.");
  });

  it("says where the plan stands for every state", () => {
    expect(statusMessage("reviewing", 1, 4)).toContain("1 of 4 have agreed");
    expect(statusMessage("approving", 4, 4)).toContain("approve their own amount");
    expect(statusMessage("held", 4, 4)).toContain("being booked");
    expect(statusMessage("captured", 4, 4)).toContain("The trip is booked");
    expect(statusMessage("expired", 0, 4)).toContain("has ended");
  });
});

describe("exchange rates", () => {
  it("needs none when everyone pays in the group's currency", async () => {
    const result = await new StaticFxRates().forCurrencies("USD", ["USD", "USD"]);
    expect(result.ok && result.value).toEqual({ baseCurrency: "USD", source: "same-currency", ratesPerBase: {} });
  });

  it("uses the rates it has for other currencies", async () => {
    const result = await new StaticFxRates({ SGD: 1.35 }).forCurrencies("USD", ["USD", "SGD"]);
    expect(result.ok && result.value.ratesPerBase).toEqual({ SGD: 1.35 });
  });

  it("refuses a currency it has no rate for instead of guessing", async () => {
    const result = await new StaticFxRates({ SGD: 1.35 }).forCurrencies("USD", ["JPY", "SGD"]);
    expect(result.ok ? null : result.error.message).toContain("JPY");
  });
});
