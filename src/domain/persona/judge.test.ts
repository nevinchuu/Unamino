import { describe, expect, it } from "vitest";
import { changeReasonFor, checkRules, type PlanFacts } from "./judge";
import { PERSONAS, PERSONAS_PER_GROUP, personaByKey } from "./profiles";

const facts = (overrides: Partial<PlanFacts> = {}): PlanFacts => ({ shareMinor: 8_000, currency: "USD", rooms: [{ occupants: 1, freeCancellation: true }], onFlight: false, ...overrides });
const rules = (key: string) => personaByKey(key)?.rules ?? {};

describe("checkRules", () => {
  it("accepts a plan that breaks nothing", () => {
    expect(checkRules(rules("maya"), facts())).toEqual({ ok: true });
    expect(checkRules(rules("leo"), facts())).toEqual({ ok: true });
    expect(checkRules(rules("dan"), facts())).toEqual({ ok: true });
  });

  it("refuses a share above the budget, naming both amounts", () => {
    const verdict = checkRules(rules("maya"), facts({ shareMinor: 12_749 }));
    expect(verdict).toEqual({ ok: false, problems: ["your share is $127.49, above the $110.00 you can afford"], codes: ["budget"] });
  });

  it("allows a share exactly at the budget", () => {
    expect(checkRules(rules("maya"), facts({ shareMinor: 11_000 }))).toEqual({ ok: true });
  });

  it("does not hold a persona with no budget to one, or one whose share cannot be priced", () => {
    expect(checkRules(rules("leo"), facts({ shareMinor: 999_999 }))).toEqual({ ok: true });
    expect(checkRules(rules("maya"), facts({ shareMinor: null }))).toEqual({ ok: true });
  });

  it("refuses sharing a room when the persona wants their own", () => {
    expect(checkRules(rules("leo"), facts({ rooms: [{ occupants: 2, freeCancellation: true }] }))).toEqual({ ok: false, problems: ["you would be sharing a hotel room, and you want a room to yourself"], codes: ["room"] });
  });

  it("is happy for others to share a room that does not hold the persona", () => {
    expect(checkRules(rules("priya"), facts({ rooms: [{ occupants: 3, freeCancellation: false }] }))).toEqual({ ok: true });
  });

  it("refuses a hotel that is not free to cancel when the persona needs one that is", () => {
    expect(checkRules(rules("dan"), facts({ rooms: [{ occupants: 1, freeCancellation: false }] }))).toEqual({ ok: false, problems: ["the hotel is not free to cancel, and you need one that is"], codes: ["cancellation"] });
  });

  it("never accepts a flight, because no persona has a passport to give", () => {
    for (const persona of PERSONAS) expect(checkRules(persona.rules, facts({ onFlight: true })).ok).toBe(false);
  });

  it("lists every problem at once", () => {
    const verdict = checkRules({ maxShareMinor: 5_000, ownRoom: true, freeCancellation: true }, facts({ shareMinor: 9_000, rooms: [{ occupants: 2, freeCancellation: false }] }));
    expect(verdict.ok ? [] : verdict.problems).toHaveLength(3);
  });
});

describe("changeReasonFor", () => {
  it("says too expensive for a budget problem and a different pick for anything else", () => {
    expect(changeReasonFor(["budget"])).toBe("too_expensive");
    expect(changeReasonFor(["room", "budget"])).toBe("too_expensive");
    expect(changeReasonFor(["room"])).toBe("different_pick");
    expect(changeReasonFor(["flight", "cancellation"])).toBe("different_pick");
  });
});

describe("the personas", () => {
  it("are distinct, and fit in a group", () => {
    expect(new Set(PERSONAS.map((persona) => persona.key)).size).toBe(PERSONAS.length);
    expect(new Set(PERSONAS.map((persona) => persona.name)).size).toBe(PERSONAS.length);
    expect(PERSONAS.length).toBeLessThanOrEqual(PERSONAS_PER_GROUP);
  });

  it("each have made-up hotel details with no passport, on example.com", () => {
    for (const persona of PERSONAS) {
      expect(persona.identity.email.endsWith("@example.com")).toBe(true);
      expect(persona.identity).not.toHaveProperty("passport");
      expect(persona.identity.birthday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("together cover a tight budget, a room alone and free cancellation", () => {
    expect(PERSONAS.some((persona) => persona.rules.maxShareMinor !== undefined && persona.rules.maxShareMinor <= 15_000)).toBe(true);
    expect(PERSONAS.some((persona) => persona.rules.ownRoom)).toBe(true);
    expect(PERSONAS.some((persona) => persona.rules.freeCancellation)).toBe(true);
  });
});
