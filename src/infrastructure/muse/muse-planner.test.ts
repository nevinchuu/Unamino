import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import { buildPlan } from "@/domain/planner/build-plan";
import { BANGKOK_CONSTRAINTS, BANGKOK_OFFERS, FX, MEMBER_IDS, MEMBERS, NOW, WIREFRAME_PLAN } from "@/domain/planner/test-support";
import extractOk from "./fixtures/completion-extract-ok.json";
import { assessTripBrief } from "@/domain/trip/brief";
import { tripToQueries } from "@/domain/trip/queries";
import liveAnswers from "./fixtures/live-answers-bangkok.json";
import { museConfigFromEnv } from "./muse-config";
import { MuseHttp, type Completion, type CompletionRequest, type MuseError } from "./muse-http";
import { MusePlanner, type CompletionClient } from "./muse-planner";
import { PLAN_EXAMPLE } from "./prompts/propose-plan";
import { SUGGESTION_EXAMPLE } from "./prompts/suggest-free-time";

const MEMBER_LIST = [...MEMBER_IDS];
const USAGE = { promptTokens: 1, completionTokens: 1, reasoningTokens: 0 };

const answer = (text: string): Result<Completion, MuseError> => ok({ text, model: "muse-spark-1.3", usage: USAGE });
const failure = (code: MuseError["code"], message = "boom"): Result<Completion, MuseError> => err({ code, message });

/** A transport that replies from `replies` in order (repeating the last) and records every request. */
function scripted(replies: readonly Result<Completion, MuseError>[]) {
  const requests: CompletionRequest[] = [];
  const client: CompletionClient = {
    async complete(request) {
      requests.push(request);
      return replies[Math.min(requests.length, replies.length) - 1];
    },
  };
  return { planner: new MusePlanner(client), requests };
}

const extractInput = { memberIds: MEMBER_LIST, messages: [{ memberId: "ana", text: "after 6pm" }] };
const proposeInput = { memberIds: MEMBER_LIST, constraints: BANGKOK_CONSTRAINTS, offers: BANGKOK_OFFERS, feedback: [] as string[] };
const suggestInput = {
  city: "Bangkok",
  memberIds: MEMBER_LIST,
  constraints: {},
  gaps: [{ id: "gap-1", date: "2026-12-12", startTime: "12:30", endTime: "13:30", minutes: 60 }],
  feedback: [] as string[],
};

const codeOf = <T>(result: Result<T, { code: string }>): string | null => (result.ok ? null : result.error.code);
const messageOf = <T>(result: Result<T, { message: string }>): string => (result.ok ? "" : result.error.message);

describe("extracting constraints", () => {
  const constraintsJson = JSON.stringify({ constraints: BANGKOK_CONSTRAINTS });

  it("returns the constraints Muse read from the chat", async () => {
    const { planner, requests } = scripted([answer(constraintsJson)]);
    const result = await planner.extractConstraints({ memberIds: MEMBER_LIST, messages: [{ memberId: "ana", text: "marker-7731" }] });
    expect(result.ok && result.value).toEqual(BANGKOK_CONSTRAINTS);
    expect(requests).toHaveLength(1);
    expect(requests[0].user).toContain("marker-7731");
    expect(requests[0].system).not.toContain("marker-7731");
  });

  it("works through the real transport on the saved real response", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify(extractOk), { status: 200 })) as unknown as typeof fetch;
    const planner = new MusePlanner(new MuseHttp({ apiKey: "k", fetchImpl }));
    const result = await planner.extractConstraints(extractInput);
    expect(result.ok && result.value).toEqual(BANGKOK_CONSTRAINTS);
  });

  it("drops a member id the model made up", async () => {
    const invented = JSON.stringify({ constraints: { ...BANGKOK_CONSTRAINTS, mallory: { ownRoom: true } } });
    const result = await scripted([answer(invented)]).planner.extractConstraints(extractInput);
    expect(result.ok && Object.keys(result.value).sort()).toEqual(["ana", "ben", "jia"]);
  });

  it("tries once more when the answer is unusable, then succeeds", async () => {
    const { planner, requests } = scripted([answer("not json at all"), answer(constraintsJson)]);
    const result = await planner.extractConstraints(extractInput);
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it("gives up after the second bad answer and says what was wrong", async () => {
    const { planner, requests } = scripted([answer("not json"), answer('{"constraints":{"ana":{"budgetCap":{"amountMinor":-5,"currency":"USD"}}}}')]);
    const result = await planner.extractConstraints(extractInput);
    expect(codeOf(result)).toBe("invalid_output");
    expect(messageOf(result)).toContain("does not match the schema");
    expect(requests).toHaveLength(2);
  });

  it("does not retry when the service itself is the problem", async () => {
    const { planner, requests } = scripted([failure("unavailable", "Muse rejected the API key")]);
    const result = await planner.extractConstraints(extractInput);
    expect(result.ok ? null : result.error).toEqual({ code: "planner_unavailable", message: "Muse rejected the API key" });
    expect(requests).toHaveLength(1);
  });
});

describe("reading the chat for where and when", () => {
  const briefInput = { memberIds: MEMBER_LIST, messages: [{ memberId: "nevin", text: "Bangkok, 11 to 13 Dec" }], today: "2026-10-27" };
  const briefJson = JSON.stringify({ fields: { destinationCity: "Bangkok", destinationCountry: "TH", destinationAirport: "BKK", departDate: "2026-12-11", returnDate: "2026-12-13" }, questions: ["Which airport will you fly from?"] });

  it("returns what the model understood and what it still needs to ask", async () => {
    const result = await scripted([answer(briefJson)]).planner.extractTripBrief(briefInput);
    expect(result.ok && result.value.fields.destinationAirport).toBe("BKK");
    expect(result.ok && result.value.questions).toEqual(["Which airport will you fly from?"]);
  });

  it("accepts null for a field that was not mentioned", async () => {
    const result = await scripted([answer('{"fields":{"destinationCity":"Bangkok","originAirport":null},"questions":[]}')]).planner.extractTripBrief(briefInput);
    expect(result.ok && result.value.fields.originAirport).toBeUndefined();
  });

  it("tries once more when the answer is unusable, and says what was wrong if it still is", async () => {
    const fixed = scripted([answer("sorry"), answer(briefJson)]);
    expect((await fixed.planner.extractTripBrief(briefInput)).ok).toBe(true);
    expect(fixed.requests).toHaveLength(2);

    const stuck = scripted([answer("sorry"), answer('{"fields":{"price":1},"questions":[]}')]);
    const result = await stuck.planner.extractTripBrief(briefInput);
    expect(codeOf(result)).toBe("invalid_output");
    expect(messageOf(result)).toContain("does not match the schema");
  });

  it("does not retry an outage", async () => {
    const { planner, requests } = scripted([failure("unavailable")]);
    expect(codeOf(await planner.extractTripBrief(briefInput))).toBe("planner_unavailable");
    expect(requests).toHaveLength(1);
  });

  it("sends the chat in the user message and the date with it", async () => {
    const { planner, requests } = scripted([answer(briefJson)]);
    await planner.extractTripBrief(briefInput);
    expect(requests[0].user).toContain("Bangkok, 11 to 13 Dec");
    expect(requests[0].user).toContain("2026-10-27");
    expect(requests[0].system).not.toContain("Bangkok, 11 to 13 Dec");
  });
});

describe("proposing a plan", () => {
  it("returns a valid plan", async () => {
    const result = await scripted([answer(JSON.stringify(PLAN_EXAMPLE))]).planner.proposePlan(proposeInput);
    expect(result.ok && result.value).toEqual(PLAN_EXAMPLE);
  });

  it("accepts a plan wrapped in code fences, which models often add", async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(WIREFRAME_PLAN)}\n\`\`\``;
    expect((await scripted([answer(fenced)]).planner.proposePlan(proposeInput)).ok).toBe(true);
  });

  it("makes one call and leaves retrying to the planning loop", async () => {
    const { planner, requests } = scripted([answer("nope")]);
    expect(codeOf(await planner.proposePlan(proposeInput))).toBe("invalid_output");
    expect(requests).toHaveLength(1);
  });

  it("says in plain words what was wrong, so the loop can feed it back", async () => {
    expect(messageOf(await scripted([answer("nope")]).planner.proposePlan(proposeInput))).toContain("not valid JSON");
    expect(messageOf(await scripted([answer('{"title":"x"}')]).planner.proposePlan(proposeInput))).toContain("picks");
  });

  it("rejects an answer that tries to set a price, because the plan has no price field", async () => {
    const withPrice = JSON.stringify({ ...WIREFRAME_PLAN, totalMinor: 1, picks: WIREFRAME_PLAN.picks.map((pick) => ({ ...pick, priceMinor: 1 })) });
    expect(codeOf(await scripted([answer(withPrice)]).planner.proposePlan(proposeInput))).toBe("invalid_output");
  });

  it("treats running out of tokens as an outage, not as feedback the model can act on", async () => {
    const result = await scripted([failure("truncated", "Muse ran out of tokens")]).planner.proposePlan(proposeInput);
    expect(codeOf(result)).toBe("planner_unavailable");
  });

  it("treats a refusal or an empty answer as invalid output worth another try", async () => {
    expect(codeOf(await scripted([failure("refused")]).planner.proposePlan(proposeInput))).toBe("invalid_output");
    expect(codeOf(await scripted([failure("invalid_response")]).planner.proposePlan(proposeInput))).toBe("invalid_output");
  });
});

describe("inside the planning loop", () => {
  const loopInput = (planner: MusePlanner) => ({
    planner,
    members: MEMBERS,
    constraints: BANGKOK_CONSTRAINTS,
    offers: BANGKOK_OFFERS,
    fx: FX,
    requiredKinds: ["flight", "hotel"] as const,
    now: NOW,
  });

  it("builds the wireframe plan from Muse's answer, with nobody let down", async () => {
    const result = await buildPlan(loopInput(scripted([answer(JSON.stringify(WIREFRAME_PLAN))]).planner));
    expect(result.ok && result.value.plan.totalMinor).toBe(155000);
    expect(result.ok && result.value.violations).toEqual([]);
  });

  it("tells Muse what was wrong with a bad first answer, and takes the corrected one", async () => {
    const { planner, requests } = scripted([answer("sorry, here is your plan: lots of text"), answer(JSON.stringify(WIREFRAME_PLAN))]);
    const result = await buildPlan(loopInput(planner));
    expect(result.ok && result.value.attempts).toBe(2);
    const feedback = (JSON.parse(requests[1].user) as { data: { feedback: string[] } }).data.feedback;
    expect(feedback.join(" ")).toContain("not valid JSON");
  });

  it("states what a complete plan needs, because the loop passes the required kinds on", async () => {
    const { planner, requests } = scripted([answer(JSON.stringify(WIREFRAME_PLAN))]);
    await buildPlan(loopInput(planner));
    expect(requests[0].system).toContain("flight, hotel");
  });

  it("stops at once when the service is unavailable", async () => {
    const { planner, requests } = scripted([failure("unavailable", "Muse is rate limiting requests")]);
    const result = await buildPlan(loopInput(planner));
    expect(codeOf(result)).toBe("planner_unavailable");
    expect(requests).toHaveLength(1);
  });
});

describe("suggesting free time", () => {
  it("returns valid suggestions", async () => {
    const result = await scripted([answer(JSON.stringify(SUGGESTION_EXAMPLE))]).planner.suggestFreeTime(suggestInput);
    expect(result.ok && result.value).toEqual(SUGGESTION_EXAMPLE);
  });

  it("accepts no suggestions at all", async () => {
    const result = await scripted([answer('{"suggestions":[]}')]).planner.suggestFreeTime(suggestInput);
    expect(result.ok && result.value.suggestions).toEqual([]);
  });

  it("rejects suggestions with an address or hours, which only the map service may supply", async () => {
    const extra = JSON.stringify({ suggestions: [{ ...SUGGESTION_EXAMPLE.suggestions[0], address: "1 Made Up Road", openingHours: "24h" }] });
    expect(codeOf(await scripted([answer(extra)]).planner.suggestFreeTime(suggestInput))).toBe("invalid_output");
  });

  it("reports an outage as unavailable", async () => {
    expect(codeOf(await scripted([failure("unavailable")]).planner.suggestFreeTime(suggestInput))).toBe("planner_unavailable");
  });
});

describe("reading the Muse settings", () => {
  it("needs the key and nothing else", () => {
    const result = museConfigFromEnv({ MUSE_SPARK_API_KEY: "secret" });
    expect(result.ok && result.value).toEqual({ apiKey: "secret" });
  });

  it("takes a model and address when given", () => {
    const result = museConfigFromEnv({ MUSE_SPARK_API_KEY: " secret ", MUSE_MODEL: "muse-spark-1.2", MUSE_BASE_URL: "https://example.test/v1" });
    expect(result.ok && result.value).toEqual({ apiKey: "secret", model: "muse-spark-1.2", baseUrl: "https://example.test/v1" });
  });

  it("ignores blank optional settings, which an empty line in .env produces", () => {
    const result = museConfigFromEnv({ MUSE_SPARK_API_KEY: "secret", MUSE_MODEL: "", MUSE_BASE_URL: "  " });
    expect(result.ok && result.value).toEqual({ apiKey: "secret" });
  });

  it("says plainly when the key is missing or blank, without naming any value", () => {
    for (const env of [{}, { MUSE_SPARK_API_KEY: "" }, { MUSE_SPARK_API_KEY: "   " }]) {
      const result = museConfigFromEnv(env);
      expect(result.ok ? null : result.error).toEqual({ code: "not_configured", message: "MUSE_SPARK_API_KEY is not set" });
    }
  });
});

describe("on Muse's real answers for the Bangkok trip", () => {
  it("reads the chat into exactly the constraints that were asked for", async () => {
    const result = await scripted([answer(liveAnswers.extract)]).planner.extractConstraints(extractInput);
    expect(result.ok && result.value).toEqual(BANGKOK_CONSTRAINTS);
  });

  it("proposes a plan that passes validation and lets nobody down, priced by code", async () => {
    const result = await buildPlan({
      planner: scripted([answer(liveAnswers.propose)]).planner,
      members: MEMBERS,
      constraints: BANGKOK_CONSTRAINTS,
      offers: BANGKOK_OFFERS,
      fx: FX,
      requiredKinds: ["flight", "hotel"],
      now: NOW,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.violations).toEqual([]);
    // Muse chose not to add the cooking class, so the total is lower than the wireframe's; the price is still code's.
    expect(result.value.plan.totalMinor).toBe(146000);
    expect(result.value.shares.map((share) => share.shareMinor)).toEqual([35000, 35000, 35000, 41000]);
  });

  it.each(liveAnswers.suggest.map((text, index) => [index + 1, text] as const))("gives suggestions the schema accepts (answer %i)", async (_index, text) => {
    const result = await scripted([answer(text)]).planner.suggestFreeTime(suggestInput);
    expect(result.ok && result.value.suggestions.length).toBeGreaterThan(0);
  });
});

describe("on Muse's real reading of the chat for where and when", () => {
  const today = "2026-10-27";
  const input = { memberIds: MEMBER_LIST, messages: [{ memberId: "nevin", text: "Let's do Bangkok, leaving Fri 11 Dec and back Sun 13 Dec. We all fly from Singapore" }], today };

  it("understood the whole trip, and the code agrees it is enough to search", async () => {
    const result = await scripted([answer(liveAnswers.brief)]).planner.extractTripBrief(input);
    if (!result.ok) throw new Error(result.error.message);
    const assessment = assessTripBrief({ fields: result.value.fields, modelQuestions: result.value.questions, today });
    expect(assessment).toEqual({
      status: "complete",
      trip: { destinationCity: "Bangkok", destinationCountry: "TH", destinationAirport: "BKK", originAirport: "SIN", departDate: "2026-12-11", returnDate: "2026-12-13" },
    });
  });

  it("asked sensible questions instead of guessing when the chat was vague", async () => {
    const result = await scripted([answer(liveAnswers.briefVague)]).planner.extractTripBrief({ ...input, messages: [{ memberId: "nevin", text: "let's go somewhere warm soon!" }] });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.fields).toEqual({});
    const assessment = assessTripBrief({ fields: result.value.fields, modelQuestions: result.value.questions, today });
    expect(assessment.status === "incomplete" && assessment.questions).toHaveLength(3);
  });

  it("makes searches for the whole group from what it understood", async () => {
    const result = await scripted([answer(liveAnswers.brief)]).planner.extractTripBrief(input);
    if (!result.ok) throw new Error(result.error.message);
    const assessment = assessTripBrief({ fields: result.value.fields, modelQuestions: [], today });
    if (assessment.status !== "complete") throw new Error("expected a complete trip");
    expect(tripToQueries(assessment.trip, 4).map((q) => `${q.kind}:${q.guests}`)).toEqual(["flight:4", "hotel:1", "hotel:2", "hotel:3", "hotel:4"]);
  });
});
