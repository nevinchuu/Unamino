import { describe, expect, it } from "vitest";
import type { PlanCardSummary } from "@/domain/agent/ports";
import type { Member, Message } from "@/domain/group/types";
import { AGENT_NAME, EARLIER_PAGE, handleEarlier, handlePoll, loadChat, POLL_LIMIT, toMessageDto, type EarlierDeps, type PollDeps } from "./chat";

const GROUP = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const NOW = new Date("2026-10-27T10:00:00Z");

const message = (seq: number, overrides: Partial<Message> = {}): Message => ({
  id: `m-${seq}`, seq, groupId: GROUP, memberId: "ana", kind: "human", body: `message ${seq}`, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: new Date(NOW.getTime() + seq * 1000), ...overrides,
});

const NAMES = new Map([["ana", "Ana"], ["ben", "Ben"]]);
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };
const PLAN: PlanCardSummary = { id: "plan-1", title: "Bangkok weekend", status: "reviewing", headcount: 4, agreedCount: 1, replacedById: null };

interface Setup {
  stored?: Message[];
  running?: boolean;
  plans?: PlanCardSummary[];
  member?: Member | null;
}

const MINE = { canAgree: true, agreed: false, canRequestChanges: true, shareMinor: 32_000, currency: "USD", lines: [], people: [], needsAmount: false };

function setup({ stored = [], running = false, plans = [], member = ana }: Setup = {}) {
  const asked: string[] = [];
  const cardsFor: string[] = [];
  const marked: string[] = [];
  const deps: PollDeps = {
    groups: { memberNames: async () => NAMES, joinedMembers: async () => [ana, { ...ana, id: "ben", displayName: "Ben" }] },
    messages: {
      listAfter: async (_group, afterSeq, limit) => (asked.push(`after ${afterSeq} limit ${limit}`), stored.filter((m) => m.seq > afterSeq).slice(0, limit)),
      recent: async (_group, limit) => (asked.push(`recent ${limit}`), stored.slice(-limit)),
    },
    runs: { isRunning: async () => running },
    plans: { cards: async () => plans },
    viewerCards: { forPlan: async (planId, memberId) => (cardsFor.push(`${planId}:${memberId}`), MINE) },
    reads: { markRead: async (memberId, seq) => void marked.push(`${memberId}:${seq}`) },
    clock: () => NOW,
    memberOf: async () => member,
  };
  return { deps, asked, cardsFor, marked };
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
    // It asks for one more than it shows, to know whether anything came before.
    expect(asked).toEqual(["recent 3"]);
  });

  it("says there is an earlier page only when something really comes before what it shows", async () => {
    const { deps } = setup({ stored: [message(1), message(2), message(3)] });
    expect((await loadChat(deps, GROUP, { afterSeq: null, limit: 2 })).hasEarlier).toBe(true);
    expect((await loadChat(deps, GROUP, { afterSeq: null, limit: 3 })).hasEarlier).toBe(false);
    expect((await loadChat(deps, GROUP, { afterSeq: 1, limit: 10 })).hasEarlier).toBe(false);
  });

  it("counts the messages it hands to a person as read by them, up to the newest", async () => {
    const { deps, marked } = setup({ stored: [message(1), message(2), message(3)] });
    await loadChat(deps, GROUP, { afterSeq: null, limit: 2 }, "ana");
    expect(marked).toEqual(["ana:3"]);
  });

  it("marks nothing read when there was nothing new, or when nobody is asking", async () => {
    const { deps, marked } = setup({ stored: [message(1)] });
    await loadChat(deps, GROUP, { afterSeq: 1, limit: 10 }, "ana");
    await loadChat(deps, GROUP, { afterSeq: null, limit: 10 });
    expect(marked).toEqual([]);
  });

  it("brings only what is newer when it has a starting point", async () => {
    const { deps } = setup({ stored: [message(1), message(2), message(3)] });
    expect((await loadChat(deps, GROUP, { afterSeq: 2, limit: 10 })).messages.map((m) => m.seq)).toEqual([3]);
  });

  it("lists who is in now, whether the agent is working, and each plan with its own state and nothing internal", async () => {
    const paid: PlanCardSummary = { ...PLAN, id: "plan-0", status: "captured", agreedCount: 4 };
    const { deps } = setup({ running: true, plans: [paid, PLAN] });
    const chat = await loadChat(deps, GROUP, { afterSeq: 0, limit: 10 });
    expect(chat.members).toEqual(["Ana", "Ben"]);
    expect(chat.agentWorking).toBe(true);
    expect(chat.plans).toEqual([{ ...paid, mine: null }, { ...PLAN, mine: null }]);
  });

  it("has no plan card before there is a plan", async () => {
    expect((await loadChat(setup().deps, GROUP, { afterSeq: 0, limit: 10 })).plans).toEqual([]);
  });
});

describe("handlePoll", () => {
  it("answers a member with what is new", async () => {
    const { deps } = setup({ stored: [message(1), message(2)] });
    const response = await poll(deps, "?after=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ messages: [{ seq: 2, senderName: "Ana" }], members: ["Ana", "Ben"], agentWorking: false, plans: [] });
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

  describe("what the plan cards offer the person asking", () => {
    const later: PlanCardSummary = { ...PLAN, id: "plan-2", title: "Later plan" };

    it("puts it on the newest open plan only, and on none of the others", async () => {
      const { deps, cardsFor } = setup({ plans: [{ ...PLAN, replacedById: "plan-2" }, later, { ...PLAN, id: "plan-0", status: "captured" }] });
      const chat = await loadChat(deps, GROUP, { afterSeq: 0, limit: 10 }, "ana");

      expect(chat.plans.map((plan) => [plan.id, plan.mine])).toEqual([["plan-1", null], ["plan-2", MINE], ["plan-0", null]]);
      expect(cardsFor).toEqual(["plan-2:ana"]);
    });

    it("also works while the plan waits for amounts to be approved", async () => {
      const { deps } = setup({ plans: [{ ...PLAN, status: "approving" }] });
      expect((await loadChat(deps, GROUP, { afterSeq: 0, limit: 10 }, "ana")).plans[0].mine).toEqual(MINE);
    });

    it("reads nothing, and offers nothing, when there is no person asking or no plan is open", async () => {
      const nobody = setup({ plans: [PLAN] });
      expect((await loadChat(nobody.deps, GROUP, { afterSeq: 0, limit: 10 })).plans[0].mine).toBeNull();
      const finished = setup({ plans: [{ ...PLAN, status: "expired" }] });
      expect((await loadChat(finished.deps, GROUP, { afterSeq: 0, limit: 10 }, "ana")).plans[0].mine).toBeNull();
      expect([...nobody.cardsFor, ...finished.cardsFor]).toEqual([]);
    });

    it("asks about the person who made the poll, not anyone else", async () => {
      const { deps, cardsFor } = setup({ plans: [PLAN] });
      const body = (await (await poll(deps, "?after=0")).json()) as { plans: { mine: unknown }[] };
      expect(cardsFor).toEqual(["plan-1:ana"]);
      expect(body.plans[0].mine).toEqual(MINE);
    });
  });
});

describe("handleEarlier", () => {
  const many = Array.from({ length: EARLIER_PAGE + 20 }, (_, index) => message(index + 1));

  function earlier(stored: Message[] = many, member: Member | null = ana) {
    const deps: EarlierDeps = {
      groups: { memberNames: async () => NAMES },
      messages: { listBefore: async (_group, beforeSeq, limit) => stored.filter((m) => m.seq < beforeSeq).slice(-limit) },
      memberOf: async () => member,
    };
    return (query: string, groupId = GROUP) => handleEarlier(new Request(`http://localhost/api/groups/${groupId}/earlier${query}`), groupId, deps);
  }

  it("brings the page just before the oldest message the person has, oldest first, and says more remain", async () => {
    const response = await earlier()("?before=71");
    const page = (await response.json()) as { messages: { seq: number }[]; hasEarlier: boolean };
    expect(page.messages.map((m) => m.seq)).toEqual(Array.from({ length: EARLIER_PAGE }, (_, index) => 21 + index));
    expect(page.hasEarlier).toBe(true);
  });

  it("says nothing more remains when the page reaches the start of the chat", async () => {
    const page = (await (await earlier()("?before=11")).json()) as { messages: { seq: number }[]; hasEarlier: boolean };
    expect(page.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(page.hasEarlier).toBe(false);
  });

  it("puts names on the messages and keeps internals out", async () => {
    const page = (await (await earlier()("?before=3")).json()) as { messages: Record<string, unknown>[] };
    expect(page.messages[0]).toMatchObject({ senderName: "Ana" });
    expect(Object.keys(page.messages[0])).not.toContain("groupId");
  });

  it.each(["", "?before=abc", "?before=-1", "?before=0", "?before=1.5"])("refuses a bad starting point %j", async (query) => {
    expect((await earlier()(query)).status).toBe(400);
  });

  it("answers someone who is not in the group, or a malformed group id, the same way", async () => {
    expect((await earlier(many, null)("?before=5")).status).toBe(401);
    expect((await earlier()("?before=5", "not-a-group")).status).toBe(401);
  });
});
