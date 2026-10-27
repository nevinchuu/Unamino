import { describe, expect, it } from "vitest";
import { parseExtractionText, parsePlannerOutput, parsePlannerText } from "./schema";
import { WIREFRAME_PLAN } from "./test-support";

describe("planner output schema", () => {
  it("accepts a plan with per-member notes and compromises", () => {
    const withCompromise = { ...WIREFRAME_PLAN, compromises: [{ memberId: "ben", note: "At his cap" }] };
    expect(parsePlannerOutput(withCompromise).ok).toBe(true);
  });

  it("rejects a price field, so the planner cannot invent one", () => {
    const bad = { ...WIREFRAME_PLAN, picks: [{ ...WIREFRAME_PLAN.picks[0], totalMinor: 1 }] };
    expect(parsePlannerOutput(bad).ok).toBe(false);
  });

  it("rejects unknown top-level fields, empty picks and empty member lists", () => {
    expect(parsePlannerOutput({ ...WIREFRAME_PLAN, extra: true }).ok).toBe(false);
    expect(parsePlannerOutput({ ...WIREFRAME_PLAN, picks: [] }).ok).toBe(false);
    expect(parsePlannerOutput({ ...WIREFRAME_PLAN, picks: [{ offerId: "x", reason: "r", members: [] }] }).ok).toBe(false);
  });

  it("names the failing field in the error", () => {
    const result = parsePlannerOutput({ title: "", picks: WIREFRAME_PLAN.picks });
    expect(!result.ok && result.error.code).toBe("invalid_shape");
    expect(!result.ok && result.error.message).toContain("title");
  });
});

describe("parsePlannerText", () => {
  it("parses plain JSON and JSON inside a code fence", () => {
    const json = JSON.stringify(WIREFRAME_PLAN);
    expect(parsePlannerText(json).ok).toBe(true);
    expect(parsePlannerText("```json\n" + json + "\n```").ok).toBe(true);
    expect(parsePlannerText("```\n" + json + "\n```").ok).toBe(true);
  });

  it("reports text that is not JSON", () => {
    const result = parsePlannerText("Sure! Here is a plan: ...");
    expect(result.ok ? null : result.error.code).toBe("invalid_json");
  });
});

describe("constraint extraction output", () => {
  it("parses constraints keyed by member", () => {
    const text = JSON.stringify({ constraints: { ana: { outboundDeparture: { after: "18:00" } }, jia: { ownRoom: true } } });
    const result = parseExtractionText(text);
    expect(result.ok && result.value.constraints.ana.outboundDeparture?.after).toBe("18:00");
  });

  it("rejects bad constraint values and extra fields", () => {
    expect(parseExtractionText(JSON.stringify({ constraints: { ana: { outboundDeparture: { after: "6pm" } } } })).ok).toBe(false);
    expect(parseExtractionText(JSON.stringify({ constraints: {}, advice: "x" })).ok).toBe(false);
    expect(parseExtractionText("not json").ok).toBe(false);
  });
});
