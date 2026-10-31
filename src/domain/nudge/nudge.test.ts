import { describe, expect, it } from "vitest";
import { err } from "@/lib/result";
import { createUsageMeter } from "@/domain/agent/run-agent";
import type { ModelTurn } from "@/domain/agent/loop/model";
import { calls, says, ScriptedChatModel } from "@/domain/agent/test-support";
import { MAX_NUDGE_LENGTH, nudgeUserMessage, settleNudge, writeNudge, type NudgeFacts } from "./nudge";

const facts: NudgeFacts = {
  name: "Leo",
  sender: "Nev",
  step: "approve",
  shareText: "$64.22",
  minutesLeft: 38,
  hotel: "Travelodge Sukhumvit 11, Superior Room",
  freeToCancel: true,
  others: ["Dan", "Priya"],
  chat: [{ from: "Leo", text: "I need a room of my own" }],
};

describe("settleNudge", () => {
  it("keeps wording that uses only what it was given", () => {
    const text = "Leo, Nev has done their part. Approving sets $64.22 aside at your bank, and there are 38 minutes left.";
    expect(settleNudge(facts, text)).toBe(text);
  });

  it("lets a share be rounded to whole dollars", () => {
    expect(settleNudge(facts, "Leo, your share is $64.")).toBe("Leo, your share is $64.");
  });

  it("throws away an amount or a number of minutes it was not given", () => {
    expect(settleNudge(facts, "Leo, your share is $120.")).toBeNull();
    expect(settleNudge(facts, "Leo, there are 5 minutes left.")).toBeNull();
    expect(settleNudge({ ...facts, minutesLeft: null }, "Leo, there are 38 minutes left.")).toBeNull();
  });

  it("allows a number that is part of the hotel's name", () => {
    expect(settleNudge(facts, "Leo, Travelodge Sukhumvit 11 has the room you wanted.")).not.toBeNull();
  });

  it("throws away wording that names anyone else in the group, whole words only", () => {
    expect(settleNudge(facts, "Leo, Dan has already approved.")).toBeNull();
    expect(settleNudge(facts, "Leo, the Danube view is nice.")).not.toBeNull();
  });

  it("throws away wording that does not start with the person's name, so the group can see who it is for", () => {
    expect(settleNudge(facts, "Hey there, whenever you are ready.")).toBeNull();
    expect(settleNudge(facts, "leo, whenever you are ready.")).not.toBeNull();
  });

  it("throws away more than two sentences", () => {
    expect(settleNudge(facts, "Leo, please approve. It sets your amount aside. Nothing is charged.")).toBeNull();
    expect(settleNudge(facts, "Leo, please approve your amount. It is only set aside at your bank.")).not.toBeNull();
    expect(settleNudge(facts, "Leo, could you approve? It costs nothing today!")).not.toBeNull();
  });

  it("throws away pressure and guilt", () => {
    expect(settleNudge(facts, "Leo, this is the last chance to approve.")).toBeNull();
    expect(settleNudge(facts, "Leo, everyone is waiting for you.")).toBeNull();
  });

  it("strips markdown and @, and throws away empty or very long wording", () => {
    expect(settleNudge(facts, "**Leo**, @Nev asked.")).toBe("Leo, Nev asked.");
    expect(settleNudge(facts, "   ")).toBeNull();
    expect(settleNudge(facts, null)).toBeNull();
    expect(settleNudge(facts, "x".repeat(MAX_NUDGE_LENGTH + 1))).toBeNull();
  });
});

describe("nudgeUserMessage", () => {
  it("gives the model the person's facts and the chat, and not the other members' names", () => {
    const message = nudgeUserMessage(facts);
    expect(message).toContain("$64.22");
    expect(message).toContain("I need a room of my own");
    expect(message).not.toContain("Priya");
  });
});

describe("writeNudge", () => {
  const model = (step: ModelTurn) => new ScriptedChatModel([step], createUsageMeter());

  it("returns what the model wrote through the tool, when it is usable", async () => {
    expect(await writeNudge(model(calls("write_nudge", { say: "Leo, whenever you are ready." })), facts)).toBe("Leo, whenever you are ready.");
  });

  it("takes plain text when the model did not use the tool", async () => {
    expect(await writeNudge(model(says("Leo, whenever you are ready.")), facts)).toBe("Leo, whenever you are ready.");
  });

  it("returns null when the model's arguments are broken, it breaks a rule, or it cannot be reached", async () => {
    expect(await writeNudge(new ScriptedChatModel([{ text: null, toolCalls: [{ id: "c", name: "write_nudge", arguments: "{not json" }] }], createUsageMeter()), facts)).toBeNull();
    expect(await writeNudge(model(calls("write_nudge", { say: "Leo, $5 is all it takes." })), facts)).toBeNull();
    expect(await writeNudge(new ScriptedChatModel([err({ code: "planner_unavailable", message: "down" })], createUsageMeter()), facts)).toBeNull();
  });
});
