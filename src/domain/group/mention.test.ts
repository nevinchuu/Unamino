import { describe, expect, it } from "vitest";
import { callsAgent, mentionsAgent, splitAgentMentions } from "./mention";

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

describe("cutting a message at its @agent mentions", () => {
  const texts = (body: string) => splitAgentMentions(body).map((part) => part.text);
  const mentions = (body: string) => splitAgentMentions(body).filter((part) => part.isMention).map((part) => part.text);

  it("marks the mention and keeps the words around it", () => {
    expect(splitAgentMentions("hey @agent plan Bangkok")).toEqual([
      { text: "hey ", isMention: false },
      { text: "@agent", isMention: true },
      { text: " plan Bangkok", isMention: false },
    ]);
  });

  it("handles a mention at the start, at the end, and on its own", () => {
    expect(splitAgentMentions("@agent go")).toEqual([{ text: "@agent", isMention: true }, { text: " go", isMention: false }]);
    expect(splitAgentMentions("ping @agent")).toEqual([{ text: "ping ", isMention: false }, { text: "@agent", isMention: true }]);
    expect(splitAgentMentions("@agent")).toEqual([{ text: "@agent", isMention: true }]);
  });

  it("finds every mention, including two in a row, and keeps the writer's capital letters", () => {
    expect(mentions("@Agent and @AGENT, @agent")).toEqual(["@Agent", "@AGENT", "@agent"]);
    expect(mentions("@agent @agent")).toEqual(["@agent", "@agent"]);
  });

  it("highlights exactly what calls the agent, and nothing else", () => {
    for (const body of ["mail me at sam@agent.com", "@agents are everywhere", "no mention here", "(@agent)", "thanks,@agent", "line one\n@agent two"]) {
      expect(splitAgentMentions(body).some((part) => part.isMention)).toBe(mentionsAgent(body));
    }
  });

  it("gives back the original text when the parts are put together, so nothing is lost or invented", () => {
    for (const body of ["", "plain", "@agent", "a @agent b @agent c", "x@agent @agent!", "😀 @agent 😀"]) {
      expect(texts(body).join("")).toBe(body);
    }
  });

  it("gives no parts for an empty message", () => {
    expect(splitAgentMentions("")).toEqual([]);
  });
});
