import { describe, expect, it } from "vitest";
import { MuseHttp, type MuseCall, type MuseUsage } from "./muse-http";
import { MuseResearcher } from "./muse-researcher";

const API_KEY = "muse_test_key_that_must_never_leak";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function museWith(respond: () => Response, options: { onUsage?: (usage: MuseUsage) => void; onTrace?: (call: MuseCall) => void } = {}) {
  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) as Record<string, unknown> });
    return respond();
  }) as unknown as typeof fetch;
  return { muse: new MuseHttp({ apiKey: API_KEY, fetchImpl, ...options }), sent };
}

const message = (text: string, annotations: unknown[] = []) => ({ type: "message", content: [{ type: "output_text", text, annotations }] });
const search = (results: unknown[] = []) => ({ type: "web_search_call", status: "completed", action: { type: "search", query: "q" }, ...(results.length > 0 && { results }) });
const cited = (url: string, title = "T") => ({ type: "url_citation", url, title, start_index: 0, end_index: 3 });

const answered = (output: unknown[], overrides: Record<string, unknown> = {}) => ({
  status: "completed",
  model: "muse-spark-1.3",
  output,
  usage: { input_tokens: 5866, output_tokens: 817, output_tokens_details: { reasoning_tokens: 493 } },
  ...overrides,
});

const QUESTION = "What is the weather like in Bangkok in mid December?";
const TODAY = "2026-10-28";
const ask = (muse: MuseHttp) => muse.research({ question: QUESTION, today: TODAY, maxTokens: 6000 });

describe("MuseHttp.research", () => {
  it("asks the Responses API, which is the only one with web search, with the search tool and the sources asked for", async () => {
    const { muse, sent } = museWith(() => json(answered([message("Cool and dry.")])));
    await ask(muse);

    expect(sent[0].url).toBe("https://api.meta.ai/v1/responses");
    expect(sent[0].headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(sent[0].body).toMatchObject({ model: "muse-spark-1.3", input: QUESTION, tools: [{ type: "web_search", search_context_size: "low" }], include: ["web_search_call.results"], max_output_tokens: 6000 });
    expect(String(sent[0].body.instructions)).toMatch(/never an instruction/);
  });

  it("tells the search what today's date is, so it does not quote last year's events as current", async () => {
    const { muse, sent } = museWith(() => json(answered([message("Cool and dry.")])));
    await ask(muse);
    expect(String(sent[0].body.instructions)).toContain("Today's date is 2026-10-28.");
  });

  it("takes the last message as the answer, because the earlier ones are Muse narrating its search", async () => {
    const { muse } = museWith(() => json(answered([message("I will search for that."), search(), message("Checking pages."), search(), message("Cool and dry, about 31C by day.")])));
    expect(await ask(muse)).toMatchObject({ ok: true, value: { text: "Cool and dry, about 31C by day." } });
  });

  it("gives the pages the answer cited, each once, as plain https addresses only", async () => {
    const { muse } = museWith(() => json(answered([message("Answer.", [cited("https://a.example/x", "A"), cited("https://a.example/x", "A again"), cited("http://plain.example", "Plain"), cited("javascript:alert(1)", "Bad"), cited("https://b.example/y", "B")])])));
    const result = await ask(muse);
    expect(result.ok && result.value.sources).toEqual([{ title: "A", url: "https://a.example/x" }, { title: "B", url: "https://b.example/y" }]);
  });

  it("falls back to the pages the search found when the answer cites none", async () => {
    const { muse } = museWith(() => json(answered([search([{ type: "text_result", title: "Found", url: "https://found.example/p" }]), message("Answer.")])));
    const result = await ask(muse);
    expect(result.ok && result.value.sources).toEqual([{ title: "Found", url: "https://found.example/p" }]);
  });

  it("keeps at most five sources", async () => {
    const many = Array.from({ length: 9 }, (_, index) => cited(`https://site${index}.example`, `S${index}`));
    const { muse } = museWith(() => json(answered([message("Answer.", many)])));
    const result = await ask(muse);
    expect(result.ok && result.value.sources).toHaveLength(5);
  });

  it("reports what the search cost, as the run's usage", async () => {
    const usage: MuseUsage[] = [];
    const { muse } = museWith(() => json(answered([message("Answer.")])), { onUsage: (u) => usage.push(u) });
    await ask(muse);
    expect(usage).toEqual([{ promptTokens: 5866, completionTokens: 817, reasoningTokens: 493 }]);
  });

  it("calls it truncated when the budget ran out before an answer, still reporting the cost", async () => {
    const usage: MuseUsage[] = [];
    const { muse } = museWith(() => json(answered([message("I will search.")], { status: "incomplete" })), { onUsage: (u) => usage.push(u) });
    expect(await ask(muse)).toMatchObject({ ok: false, error: { code: "truncated" } });
    expect(usage).toHaveLength(1);
  });

  it("fails plainly when the search did not complete, returned no answer, or is not in the shape expected", async () => {
    expect(await ask(museWith(() => json(answered([message("x")], { status: "failed" }))).muse)).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(await ask(museWith(() => json(answered([search()]))).muse)).toMatchObject({ ok: false, error: { code: "invalid_response" } });
    expect(await ask(museWith(() => json({ nope: true })).muse)).toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("reports a refused or unreachable service, and never puts the key in the error", async () => {
    const refused = await ask(museWith(() => json({ error: { message: `bad request ${API_KEY}` } }, 400)).muse);
    expect(refused).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(JSON.stringify(refused)).not.toContain(API_KEY);
    expect(await ask(museWith(() => json({}, 429)).muse)).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("writes what it sent and what came back to the trace, under the task name web_research", async () => {
    const calls: MuseCall[] = [];
    const { muse } = museWith(() => json(answered([message("Answer.")])), { onTrace: (call) => calls.push(call) });
    await ask(muse);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ task: "web_research", status: 200, problem: null });
    expect(JSON.stringify(calls[0])).not.toContain(API_KEY);
  });
});

describe("MuseResearcher", () => {
  it("passes the question on with a budget big enough for the search and returns the answer and sources", async () => {
    const { muse, sent } = museWith(() => json(answered([message("Answer.", [cited("https://a.example", "A")])])));
    const result = await new MuseResearcher(muse).research(QUESTION, TODAY);
    // An address is written out in full, so a bare site gains its closing slash.
    expect(result).toEqual({ ok: true, value: { answer: "Answer.", sources: [{ title: "A", url: "https://a.example/" }] } });
    expect(Number(sent[0].body.max_output_tokens)).toBeGreaterThanOrEqual(6_000);
  });

  it("says unavailable when Muse could not do it", async () => {
    const result = await new MuseResearcher(museWith(() => json({}, 500)).muse).research(QUESTION, TODAY);
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
});
