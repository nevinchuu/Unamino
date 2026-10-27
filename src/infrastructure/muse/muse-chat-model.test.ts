import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { ModelRequest } from "@/domain/agent/loop/model";
import type { ConversationRequest } from "./muse-http";
import { MuseChatModel } from "./muse-chat-model";

const REQUEST: ModelRequest = {
  system: "You are Trippy",
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "searching", toolCalls: [{ id: "c1", name: "search_trip", arguments: "{}" }] },
    { role: "tool", toolCallId: "c1", content: '{"flights":[]}' },
  ],
  tools: [{ name: "search_trip", description: "d", parameters: { type: "object" } }],
};

const recording = () => {
  const seen: ConversationRequest[] = [];
  return { seen, model: new MuseChatModel({ converse: async (request) => (seen.push(request), ok({ text: "ok", toolCalls: [] })) }) };
};

describe("MuseChatModel", () => {
  it("sends the conversation in the API's shape, with tools", async () => {
    const { seen, model } = recording();
    await model.turn(REQUEST);
    expect(seen[0].system).toBe("You are Trippy");
    expect(seen[0].messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "searching", tool_calls: [{ id: "c1", type: "function", function: { name: "search_trip", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: '{"flights":[]}' },
    ]);
    expect(seen[0].tools).toEqual([{ type: "function", function: { name: "search_trip", description: "d", parameters: { type: "object" } } }]);
  });

  it("leaves tool_calls off a plain assistant message", async () => {
    const { seen, model } = recording();
    await model.turn({ ...REQUEST, messages: [{ role: "assistant", content: "hello", toolCalls: [] }] });
    expect(seen[0].messages[0]).toEqual({ role: "assistant", content: "hello" });
  });

  it("returns what the model said and the tools it asked for", async () => {
    const model = new MuseChatModel({ converse: async () => ok({ text: "On it", toolCalls: [{ id: "c9", name: "search_trip", arguments: '{"a":1}' }] }) });
    expect(await model.turn(REQUEST)).toEqual(ok({ text: "On it", toolCalls: [{ id: "c9", name: "search_trip", arguments: '{"a":1}' }] }));
  });

  it.each([
    ["unavailable", "planner_unavailable"],
    ["truncated", "planner_unavailable"],
    ["refused", "invalid_output"],
    ["invalid_response", "invalid_output"],
  ] as const)("reports a %s call as %s", async (code, expected) => {
    const model = new MuseChatModel({ converse: async () => err({ code, message: "m" }) });
    expect(await model.turn(REQUEST)).toMatchObject({ ok: false, error: { code: expected } });
  });
});
