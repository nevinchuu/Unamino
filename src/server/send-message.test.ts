import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import { FakeMessages, FakeRuns } from "@/domain/agent/test-support";
import { mentionsAgent } from "@/domain/group/mention";
import type { Member, Message } from "@/domain/group/types";
import type { NewHumanMessage } from "@/domain/group/repository";
import { sendChatMessage, type SendDeps } from "./send-message";

const GROUP = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };
const NOW = new Date("2026-10-27T10:00:00Z");

function setup(options: { postFailure?: "invalid_input" | "unavailable" | "forbidden" } = {}) {
  const posted: NewHumanMessage[] = [];
  const runs = new FakeRuns();
  const agentMessages = new FakeMessages();
  let seq = 0;
  const deps: SendDeps = {
    messages: {
      post: async (input): Promise<Result<Message, { code: "invalid_input" | "unavailable" | "forbidden"; message: string }>> => {
        if (options.postFailure) return err({ code: options.postFailure, message: "internal detail" });
        posted.push(input);
        seq += 1;
        return ok({ id: `m-${seq}`, seq, groupId: input.groupId, memberId: input.memberId, kind: "human", body: input.body, replyToMessageId: input.replyToMessageId ?? null, mentionsAgent: mentionsAgent(input.body) || input.replyToMessageId === "agent-question", planId: null, createdAt: NOW });
      },
    },
    agent: { runs, messages: agentMessages, clock: () => NOW },
  };
  return { deps, posted, runs, agentMessages };
}

const send = (deps: SendDeps, member: Member | null, body: string, replyToMessageId: string | null = null) => sendChatMessage(deps, member, { groupId: GROUP, body, replyToMessageId });

describe("sendChatMessage", () => {
  it("posts an ordinary message and starts nothing", async () => {
    const { deps, posted, runs } = setup();
    const sent = await send(deps, ana, "anyone up for Bangkok?");
    expect(sent).toMatchObject({ ok: true, value: { run: null, message: { senderName: "Ana", body: "anyone up for Bangkok?", kind: "human" } } });
    expect(posted).toEqual([{ groupId: GROUP, memberId: "ana", body: "anyone up for Bangkok?" }]);
    expect(runs.started).toHaveLength(0);
  });

  it("starts a run when the message mentions the agent, and hands it back to be run after the response", async () => {
    const { deps, runs } = setup();
    const sent = await send(deps, ana, "@trippy plan Bangkok");
    expect(sent.ok && sent.value.run).toMatchObject({ groupId: GROUP, triggerMessageId: "m-1" });
    expect(runs.started).toHaveLength(1);
  });

  it("starts a run for a reply to the agent, which is how a group answers its questions", async () => {
    const { deps, posted } = setup();
    const sent = await send(deps, ana, "Singapore, leaving Friday", "agent-question");
    expect(posted[0].replyToMessageId).toBe("agent-question");
    expect(sent.ok && sent.value.run).not.toBeNull();
  });

  it("says the agent is busy, once, instead of starting a second run", async () => {
    const { deps, runs, agentMessages } = setup();
    await send(deps, ana, "@trippy first");
    const second = await send(deps, ana, "@trippy second");
    expect(second.ok && second.value.run).toBeNull();
    expect(runs.started).toHaveLength(1);
    expect(agentMessages.agentMessages).toHaveLength(1);
    expect(agentMessages.agentMessages[0].replyToMessageId).toBe("m-2");
  });

  it("refuses someone who is not a member, and someone from another group, without posting", async () => {
    const { deps, posted } = setup();
    expect(await send(deps, null, "hello")).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await send(deps, { ...ana, groupId: "another-group" }, "hello")).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(posted).toHaveLength(0);
  });

  it("tells the person what to fix for a message that cannot be posted, without the internal reason", async () => {
    const { deps } = setup({ postFailure: "invalid_input" });
    const sent = await send(deps, ana, "   ");
    expect(sent).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(JSON.stringify(sent)).not.toContain("internal detail");
  });

  it("separates a storage outage, which is worth trying again, from a refusal", async () => {
    expect(await send(setup({ postFailure: "unavailable" }).deps, ana, "hi")).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(await send(setup({ postFailure: "forbidden" }).deps, ana, "hi")).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  it("keeps the message posted when the run cannot start", async () => {
    const { deps } = setup();
    const failing: SendDeps = { ...deps, agent: { ...deps.agent, runs: { ...deps.agent.runs, countRecent: deps.agent.runs.countRecent.bind(deps.agent.runs), countAll: deps.agent.runs.countAll.bind(deps.agent.runs), start: async () => err({ code: "unavailable", message: "db down" }) } } };
    const sent = await send(failing, ana, "@trippy plan Bangkok");
    expect(sent).toMatchObject({ ok: true, value: { run: null, message: { body: "@trippy plan Bangkok" } } });
  });
});
