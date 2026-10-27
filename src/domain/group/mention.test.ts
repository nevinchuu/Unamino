import { describe, expect, it } from "vitest";
import { callsAgent, mentionsAgent } from "./mention";

describe("mentioning the agent", () => {
  it.each(["@agent plan Bangkok", "hey @Agent what do you think", "ok @AGENT.", "(@agent)", "thanks,@agent", "line one\n@agent line two"])("recognises %j", (body) => {
    expect(mentionsAgent(body)).toBe(true);
  });

  it.each([
    "no mention here",
    "mail me at sam@agent.com",
    "@agents are everywhere",
    "@agent-smith is a film",
    "agent without the at sign",
    "me@@agent",
    "",
  ])("does not treat %j as a call", (body) => {
    expect(mentionsAgent(body)).toBe(false);
  });
});

describe("calling the agent", () => {
  it("is done by a person who types @agent", () => {
    expect(callsAgent({ kind: "human", body: "@agent plan it", repliesToKind: null })).toBe(true);
  });

  it("is also done by replying to one of the agent's own messages, which is how a group answers its questions", () => {
    expect(callsAgent({ kind: "human", body: "the 18th to the 20th", repliesToKind: "agent" })).toBe(true);
  });

  it("is not done by ordinary chat, or a reply to another person", () => {
    expect(callsAgent({ kind: "human", body: "sounds good", repliesToKind: null })).toBe(false);
    expect(callsAgent({ kind: "human", body: "sounds good", repliesToKind: "human" })).toBe(false);
    expect(callsAgent({ kind: "human", body: "welcome", repliesToKind: "system" })).toBe(false);
  });

  it("can never be done by the agent or the system, so the agent cannot start itself", () => {
    expect(callsAgent({ kind: "agent", body: "@agent again", repliesToKind: "agent" })).toBe(false);
    expect(callsAgent({ kind: "system", body: "@agent", repliesToKind: null })).toBe(false);
  });
});
