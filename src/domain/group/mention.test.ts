import { describe, expect, it } from "vitest";
import { callsAgent, mentionsAgent, splitAgentMentions } from "./mention";

describe("mentioning the agent", () => {
  it.each(["@trippy plan Bangkok", "hey @Trippy what do you think", "ok @TRIPPY.", "(@trippy)", "thanks,@trippy", "line one\n@trippy line two"])("recognises %j", (body) => {
    expect(mentionsAgent(body)).toBe(true);
  });

  it.each([
    "no mention here",
    "mail me at sam@trippy.com",
    "@trippys are everywhere",
    "@trippy-smith is a film",
    "agent without the at sign",
    "me@@trippy",
    "",
  ])("does not treat %j as a call", (body) => {
    expect(mentionsAgent(body)).toBe(false);
  });
});

describe("calling the agent", () => {
  it("is done by a person who types @trippy", () => {
    expect(callsAgent({ kind: "human", body: "@trippy plan it", repliesToKind: null })).toBe(true);
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
    expect(callsAgent({ kind: "agent", body: "@trippy again", repliesToKind: "agent" })).toBe(false);
    expect(callsAgent({ kind: "system", body: "@trippy", repliesToKind: null })).toBe(false);
  });
});

describe("cutting a message at its @trippy mentions", () => {
  const texts = (body: string) => splitAgentMentions(body).map((part) => part.text);
  const mentions = (body: string) => splitAgentMentions(body).filter((part) => part.isMention).map((part) => part.text);

  it("marks the mention and keeps the words around it", () => {
    expect(splitAgentMentions("hey @trippy plan Bangkok")).toEqual([
      { text: "hey ", isMention: false },
      { text: "@trippy", isMention: true },
      { text: " plan Bangkok", isMention: false },
    ]);
  });

  it("handles a mention at the start, at the end, and on its own", () => {
    expect(splitAgentMentions("@trippy go")).toEqual([{ text: "@trippy", isMention: true }, { text: " go", isMention: false }]);
    expect(splitAgentMentions("ping @trippy")).toEqual([{ text: "ping ", isMention: false }, { text: "@trippy", isMention: true }]);
    expect(splitAgentMentions("@trippy")).toEqual([{ text: "@trippy", isMention: true }]);
  });

  it("finds every mention, including two in a row, and keeps the writer's capital letters", () => {
    expect(mentions("@Trippy and @TRIPPY, @trippy")).toEqual(["@Trippy", "@TRIPPY", "@trippy"]);
    expect(mentions("@trippy @trippy")).toEqual(["@trippy", "@trippy"]);
  });

  it("highlights exactly what calls the agent, and nothing else", () => {
    for (const body of ["mail me at sam@trippy.com", "@trippys are everywhere", "no mention here", "(@trippy)", "thanks,@trippy", "line one\n@trippy two"]) {
      expect(splitAgentMentions(body).some((part) => part.isMention)).toBe(mentionsAgent(body));
    }
  });

  it("gives back the original text when the parts are put together, so nothing is lost or invented", () => {
    for (const body of ["", "plain", "@trippy", "a @trippy b @trippy c", "x@trippy @trippy!", "😀 @trippy 😀"]) {
      expect(texts(body).join("")).toBe(body);
    }
  });

  it("gives no parts for an empty message", () => {
    expect(splitAgentMentions("")).toEqual([]);
  });
});
