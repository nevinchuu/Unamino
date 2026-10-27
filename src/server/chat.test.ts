import { describe, expect, it } from "vitest";
import type { PlanSummary } from "@/domain/agent/ports";
import type { Member, Message } from "@/domain/group/types";
import { AGENT_NAME, handlePoll, loadChat, POLL_LIMIT, toMessageDto, type PollDeps } from "./chat";

const GROUP = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const NOW = new Date("2026-10-27T10:00:00Z");

const message = (seq: number, overrides: Partial<Message> = {}): Message => ({
  id: `m-${seq}`, seq, groupId: GROUP, memberId: "ana", kind: "human", body: `message ${seq}`, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: new Date(NOW.getTime() + seq * 1000), ...overrides,
});

const NAMES = new Map([["ana", "Ana"], ["ben", "Ben"]]);
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };
const PLAN: PlanSummary = { id: "plan-1", title: "Bangkok weekend", status: "reviewing", inputsHash: "secret-hash", headcount: 4, agreedCount: 1 };

interface Setup {
  stored?: Message[];
  running?: boolean;
  plan?: PlanSummary | null;
  member?: Member | null;
}

function setup({ stored = [], running = false, plan = null, member = ana }: Setup = {}) {
  const asked: string[] = [];
  const deps: PollDeps = {
    groups: { memberNames: async () => NAMES, joinedMembers: async () => [ana, { ...ana, id: "ben", displayName: "Ben" }] },
    messages: {
      listAfter: async (_group, afterSeq, limit) => (asked.push(`after ${afterSeq} limit ${limit}`), stored.filter((m) => m.seq > afterSeq).slice(0, limit)),
      recent: async (_group, limit) => (asked.push(`recent ${limit}`), stored.slice(-limit)),
    },
    runs: { isRunning: async () => running },
    plans: { latest: async () => plan },
    clock: () => NOW,
    memberOf: async () => member,
  };
  return { deps, asked };
}

const poll = (deps: PollDeps, query: string, groupId = GROUP) => handlePoll(new Request(`http://localhost/api/groups/${groupId}/poll${query}`), groupId, deps);

describe("toMessageDto", () => {
  it("puts the sender's name on a person's message", () => {
    expect(toMessageDto(message(1), NAMES)).toMatchObject({ senderId: "ana", senderName: "Ana", at: "2026-10-27T10:00:01.000Z" });
  });

  it("names the agent, leaves a system line unsigned, and still shows someone who has left", () => {
    expect(toMessageDto(message(1, { kind: "agent", memberId: null }), NAMES).senderName).toBe(AGENT_NAME);
    expect(toMessageDto(message(1, { kind: "system", memberId: null }), NAMES).senderName).toBeNull();
    expect(toMessageDto(message(1, { memberId: "gone" }), NAMES).senderName).toBe("Former member");
  });

  it("carries the reply and plan links, and nothing about who mentioned the agent", () => {
    const dto = toMessageDto(message(1, { replyToMessageId: "m-0", planId: "plan-1", mentionsAgent: true }), NAMES);
    expect(dto).toMatchObject({ replyToId: "m-0", planId: "plan-1" });
    expect(Object.keys(dto)).not.toContain("mentionsAgent");
    expect(Object.keys(dto)).not.toContain("groupId");
  });
});

describe("loadChat", () => {
  it("opens on the latest messages when there is no starting point", async () => {
    const { deps, asked } = setup({ stored: [message(1), message(2), message(3)] });
    const chat = await loadChat(deps, GROUP, { afterSeq: null, limit: 2 });
    expect(chat.messages.map((m) => m.seq)).toEqual([2, 3]);
    expect(asked).toEqual(["recent 2"]);
  });

  it("brings only what is newer when it has a starting point", async () => {
    const { deps } = setup({ stored: [message(1), message(2), message(3)] });
    expect((await loadChat(deps, GROUP, { afterSeq: 2, limit: 10 })).messages.map((m) => m.seq)).toEqual([3]);
  });

  it("lists who is in now, whether the agent is working, and the newest plan without its internal fingerprint", async () => {
    const { deps } = setup({ running: true, plan: PLAN });
    const chat = await loadChat(deps, GROUP, { afterSeq: 0, limit: 10 });
    expect(chat.members).toEqual(["Ana", "Ben"]);
    expect(chat.agentWorking).toBe(true);
    expect(chat.plan).toEqual({ id: "plan-1", title: "Bangkok weekend", status: "reviewing", headcount: 4, agreedCount: 1 });
    expect(JSON.stringify(chat)).not.toContain("secret-hash");
  });

  it("has no plan card before there is a plan", async () => {
    expect((await loadChat(setup().deps, GROUP, { afterSeq: 0, limit: 10 })).plan).toBeNull();
  });
});

describe("handlePoll", () => {
  it("answers a member with what is new", async () => {
    const { deps } = setup({ stored: [message(1), message(2)] });
    const response = await poll(deps, "?after=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ messages: [{ seq: 2, senderName: "Ana" }], members: ["Ana", "Ben"], agentWorking: false, plan: null });
  });

  it("treats a missing starting point as the beginning", async () => {
    const { deps, asked } = setup();
    expect((await poll(deps, "")).status).toBe(200);
    expect(asked).toEqual([`after 0 limit ${POLL_LIMIT}`]);
  });

  it("is the same 401 for a stranger and for an id that is not even a group id, and reads nothing for either", async () => {
    const stranger = setup({ member: null });
    const malformed = setup();
    const a = await poll(stranger.deps, "?after=0");
    const b = await poll(malformed.deps, "?after=0", "not-a-uuid");
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(await a.json()).toEqual(await b.json());
    expect(stranger.asked).toHaveLength(0);
  });

  it.each(["abc", "-1", "1.5", "1e3", "", "99999999999999999999", " 1"])("refuses %j as a starting point", async (after) => {
    const { deps, asked } = setup();
    const response = await poll(deps, `?after=${encodeURIComponent(after)}`);
    expect(response.status).toBe(400);
    expect(asked).toHaveLength(0);
  });

  it("never lets a response be cached, because it is different every time", async () => {
    expect((await poll(setup().deps, "?after=0")).headers.get("cache-control")).toBe("no-store");
  });
});
