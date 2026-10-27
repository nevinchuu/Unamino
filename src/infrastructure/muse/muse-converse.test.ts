import { describe, expect, it } from "vitest";
import { MuseHttp, type MuseCall, type MuseUsage } from "./muse-http";

const API_KEY = "muse_test_key_that_must_never_leak";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake fetch that answers each call in order, repeating the last, and records what it was sent. */
function museWith(responses: readonly (() => Response)[], options: { onUsage?: (usage: MuseUsage) => void; onTrace?: (call: MuseCall) => void } = {}) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
    return responses[Math.min(bodies.length, responses.length) - 1]();
  }) as unknown as typeof fetch;
  return { muse: new MuseHttp({ apiKey: API_KEY, fetchImpl, ...options }), bodies };
}

const turnResponse = (message: Record<string, unknown>, finishReason = "stop") => ({
  model: "muse-spark-1.3",
  choices: [{ finish_reason: finishReason, message: { refusal: null, role: "assistant", ...message } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 } },
});

const REQ = {
  system: "sys",
  messages: [{ role: "user" as const, content: "hi" }],
  tools: [{ type: "function" as const, function: { name: "t", description: "d", parameters: { type: "object" } } }],
  maxTokens: 1000,
};

describe("a free-form conversation turn", () => {
  it("sends the tools, no JSON mode, and the conversation after the system message", async () => {
    const { muse, bodies } = museWith([() => json(turnResponse({ content: "hello" }))]);
    await muse.converse(REQ);
    expect(bodies[0]).toMatchObject({ model: "muse-spark-1.3", tool_choice: "auto", max_tokens: 1000, messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] });
    expect(bodies[0]).not.toHaveProperty("response_format");
  });

  it("leaves tools out when there are none", async () => {
    const { muse, bodies } = museWith([() => json(turnResponse({ content: "hello" }))]);
    await muse.converse({ ...REQ, tools: [] });
    expect(bodies[0]).not.toHaveProperty("tools");
  });

  it("returns the text, or the tools it asked for, or both", async () => {
    const text = museWith([() => json(turnResponse({ content: " hello " }))]);
    expect(await text.muse.converse(REQ)).toMatchObject({ ok: true, value: { text: "hello", toolCalls: [] } });

    const tools = museWith([() => json(turnResponse({ content: "On it", tool_calls: [{ id: "c1", type: "function", function: { name: "search_trip", arguments: '{"a":1}' } }] }, "tool_calls"))]);
    expect(await tools.muse.converse(REQ)).toMatchObject({ ok: true, value: { text: "On it", toolCalls: [{ id: "c1", name: "search_trip", arguments: '{"a":1}' }] } });
  });

  it("counts the cost of the turn", async () => {
    const usage: MuseUsage[] = [];
    const { muse } = museWith([() => json(turnResponse({ content: "hello" }))], { onUsage: (u) => usage.push(u) });
    await muse.converse(REQ);
    expect(usage).toEqual([{ promptTokens: 10, completionTokens: 20, reasoningTokens: 5 }]);
  });

  it("tries once more with a bigger budget when it runs out of tokens", async () => {
    const { muse, bodies } = museWith([() => json(turnResponse({ content: "" }, "length")), () => json(turnResponse({ content: "done" }))]);
    expect((await muse.converse(REQ)).ok).toBe(true);
    expect(bodies.map((body) => body.max_tokens)).toEqual([1000, 2000]);
  });

  it("rejects an answer with neither text nor tools", async () => {
    const { muse } = museWith([() => json(turnResponse({ content: null }))]);
    expect(await muse.converse(REQ)).toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("reports a refusal, and a failed call without the key", async () => {
    const refused = museWith([() => json(turnResponse({ content: null, refusal: "no" }))]);
    expect(await refused.muse.converse(REQ)).toMatchObject({ ok: false, error: { code: "refused" } });
    const down = museWith([() => json({ error: { message: `bad ${API_KEY}` } }, 400)]);
    expect(JSON.stringify(await down.muse.converse(REQ))).not.toContain(API_KEY);
  });

  it("reports the whole conversation and the raw answer to the trace", async () => {
    const seen: MuseCall[] = [];
    const { muse } = museWith([() => json(turnResponse({ content: "hello" }))], { onTrace: (call) => seen.push(call) });
    await muse.converse(REQ);
    expect(seen[0]).toMatchObject({ task: "converse", status: 200, problem: null, system: "sys" });
    expect(seen[0].user).toContain('"content":"hi"');
    expect(JSON.stringify(seen[0])).not.toContain(API_KEY);
  });
});
