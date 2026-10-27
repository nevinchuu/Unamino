import { describe, expect, it } from "vitest";
import { ok } from "@/lib/result";
import type { Planner } from "@/domain/planner/planner";
import { ScriptedPlanner } from "@/domain/planner/scripted-planner";
import { AliasingPlanner, nameMembers } from "./aliasing-planner";
import { computeInputsHash } from "./inputs-hash";
import { StaticFxRates } from "./static-fx";

// Real ids look like these: long and meaningless.
const ANA = "3f2c9a1e-7b44-4c0e-9d11-0a5b6c7d8e9f";
const BEN = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const MEMBER_IDS = [ANA, BEN];
const PEOPLE = [{ id: ANA, displayName: "Ana" }, { id: BEN, displayName: "Ben" }];

describe("showing the model stand-ins for member ids", () => {
  const scripted = new ScriptedPlanner({
    constraints: ok({ m1: { ownRoom: true }, m2: { budgetCap: { amountMinor: 35000, currency: "USD" } }, m9: { ownRoom: true } }),
    plans: [ok({ title: "t", picks: [{ offerId: "o1", reason: "r", members: [{ memberId: "m1", note: "n" }, { memberId: "m2", note: "n" }] }], compromises: [{ memberId: "m2", note: "c" }] })],
  });
  const planner: Planner = new AliasingPlanner(scripted, PEOPLE);

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

  describe("naming people in what the model writes", () => {
    const sentences = {
      constraints: ok({}),
      plans: [
        ok({
          title: "Bangkok for m1 and m2",
          summary: "A single room for m2, shared for m1",
          picks: [{ offerId: "o1", reason: "Fits m1's flight time", members: [{ memberId: "m1", note: "after 6pm, as m1 asked" }, { memberId: "m2", note: "m2 has an own room" }] }],
          compromises: [{ memberId: "m2", note: "Over m2's cap by $10" }],
        }),
      ],
      suggestions: [ok({ suggestions: [{ gapId: "g1", venueName: "Chatuchak Market", category: "market", startTime: "10:00", durationMinutes: 120, why: "m1 and m2 both like markets" }] })],
    };
    const speaker = () => new AliasingPlanner(new ScriptedPlanner(sentences), PEOPLE);

    it("puts names in the plan title, summary, reasons, notes and compromises", async () => {
      const result = await speaker().proposePlan({ memberIds: MEMBER_IDS, constraints: {}, offers: [], feedback: [] });
      if (!result.ok) throw new Error("expected a plan");
      expect(result.value.title).toBe("Bangkok for Ana and Ben");
      expect(result.value.summary).toBe("A single room for Ben, shared for Ana");
      expect(result.value.picks[0].reason).toBe("Fits Ana's flight time");
      expect(result.value.picks[0].members.map((m) => m.note)).toEqual(["after 6pm, as Ana asked", "Ben has an own room"]);
      expect(result.value.compromises?.[0].note).toBe("Over Ben's cap by $10");
      expect(JSON.stringify(result.value)).not.toMatch(/\bm\d\b/);
    });

    it("puts names in the free-time reasons", async () => {
      const result = await speaker().suggestFreeTime({ city: "Bangkok", memberIds: MEMBER_IDS, constraints: {}, gaps: [], feedback: [] });
      expect(result.ok && result.value.suggestions[0].why).toBe("Ana and Ben both like markets");
    });

    const withWhy = (why: string, people: typeof PEOPLE) =>
      new AliasingPlanner(new ScriptedPlanner({ constraints: ok({}), plans: [], suggestions: [ok({ suggestions: [{ gapId: "g1", venueName: "Market", category: "market", startTime: "10:00", durationMinutes: 60, why }] })] }), people).suggestFreeTime({ city: "Bangkok", memberIds: MEMBER_IDS, constraints: {}, gaps: [], feedback: [] });

    // A real "m2" in the model's text cannot be told from a stand-in, so it is read as one. Anything that is not a stand-in stays.
    it("leaves a stand-in that is nobody, and words that only look like one, alone", async () => {
      const result = await withWhy("Is m9 coming? The room is 20 m3 and room-m1 is booked, m1.", PEOPLE);
      expect(result.ok && result.value.suggestions[0].why).toBe("Is m9 coming? The room is 20 m3 and room-m1 is booked, Ana.");
    });

    it("replaces in one pass, so a name that looks like a stand-in is not replaced again", async () => {
      const result = await withWhy("m1 and m2", [{ id: ANA, displayName: "m2" }, { id: BEN, displayName: "Ben" }]);
      expect(result.ok && result.value.suggestions[0].why).toBe("m2 and Ben");
    });
  });

  it("does not touch a short id that happens to sit inside a longer word", () => {
    const people = [{ id: "ana", displayName: "Ana" }];
    expect(nameMembers("ana wants a banana, and ana-2 is someone else", people)).toBe("Ana wants a banana, and ana-2 is someone else");
  });
});

describe("the fingerprint of what a plan was built from", () => {
  const trip = { destinationCity: "Bangkok", destinationCountry: "TH", destinationAirport: "BKK", originAirport: "SIN", departDate: "2026-12-11", returnDate: "2026-12-13" };
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
