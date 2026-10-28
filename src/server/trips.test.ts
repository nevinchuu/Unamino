import { describe, expect, it } from "vitest";
import type { PlanCardSummary } from "@/domain/agent/ports";
import type { Group, GroupError, Member, Message } from "@/domain/group/types";
import { err, ok, type Result } from "@/lib/result";
import type { CardMine, CardPerson } from "@/lib/plan-card";
import { loadTrips, type TripsDeps } from "./trips";

const GROUP_A = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const GROUP_B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const NOW = new Date("2026-10-28T12:00:00Z");

const member = (id: string, groupId: string, displayName: string): Member => ({ id, groupId, displayName, currency: "USD", isOrganiser: false });
const message = (seq: number, groupId: string, overrides: Partial<Message> = {}): Message => ({
  id: `m-${seq}`, seq, groupId, memberId: "ana", kind: "human", body: `message ${seq}`, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: new Date(NOW.getTime() + seq * 1000), ...overrides,
});
const person = (name: string, overrides: Partial<CardPerson> = {}): CardPerson => ({ name, isMe: false, agreed: false, approved: false, held: false, ...overrides });

interface World {
  groups?: Record<string, { name: string; people: Member[]; messages?: Message[]; plans?: PlanCardSummary[] }>;
  /** token to member. */
  tokens?: Record<string, Member>;
  read?: Record<string, number>;
  standing?: CardPerson[];
}

function setup({ groups = {}, tokens = {}, read = {}, standing = [] }: World) {
  const deps: TripsDeps = {
    groups: {
      authenticate: async (token): Promise<Result<Member, GroupError>> => (tokens[token] ? ok(tokens[token]) : err({ code: "forbidden", message: "no" })),
      find: async (id): Promise<Result<Group, GroupError>> => (groups[id] ? ok({ id, name: groups[id].name, baseCurrency: "USD" }) : err({ code: "not_found", message: "none" })),
      joinedMembers: async (id) => groups[id]?.people ?? [],
      memberNames: async (id) => new Map((groups[id]?.people ?? []).map((m) => [m.id, m.displayName])),
    },
    messages: { recent: async (id) => (groups[id]?.messages ?? []).slice(-1) },
    plans: { cards: async (id) => groups[id]?.plans ?? [] },
    viewerCards: { forPlan: async () => ({ canAgree: false, agreed: false, canRequestChanges: false, shareMinor: null, currency: "USD", lines: [], people: standing, needsAmount: false } satisfies CardMine) },
    reads: { lastRead: async (ids) => new Map(ids.map((id) => [id, read[id] ?? 0])) },
  };
  return deps;
}

const ana = member("ana", GROUP_A, "Ana");
const ben = member("ben", GROUP_A, "Ben");

describe("loadTrips", () => {
  it("shows a card for each group the browser can still open, newest activity first", async () => {
    const deps = setup({
      tokens: { ta: ana, tb: member("zed", GROUP_B, "Zed") },
      groups: {
        [GROUP_A]: { name: "Bangkok weekend", people: [ana, ben], messages: [message(5, GROUP_A)] },
        [GROUP_B]: { name: "Lisbon", people: [member("zed", GROUP_B, "Zed")], messages: [message(9, GROUP_B, { memberId: "zed" })] },
      },
    });
    const trips = await loadTrips(deps, [{ groupId: GROUP_A, token: "ta" }, { groupId: GROUP_B, token: "tb" }]);
    expect(trips.map((trip) => trip.name)).toEqual(["Lisbon", "Bangkok weekend"]);
  });

  it("leaves out a cookie that no longer opens its group", async () => {
    const deps = setup({ tokens: { ta: ana }, groups: { [GROUP_A]: { name: "A", people: [ana] } } });
    expect(await loadTrips(deps, [{ groupId: GROUP_A, token: "stale" }, { groupId: GROUP_B, token: "ta" }])).toEqual([]);
  });

  it("keeps a live group on the list however many dead cookies come before it", async () => {
    const dead = Array.from({ length: 40 }, (_, index) => ({ groupId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, token: "stale" }));
    const deps = setup({ tokens: { ta: ana }, groups: { [GROUP_A]: { name: "Alive", people: [ana] } } });
    expect((await loadTrips(deps, [...dead, { groupId: GROUP_A, token: "ta" }])).map((trip) => trip.name)).toEqual(["Alive"]);
  });

  it("shows a message from someone else as unread until it has been read, but never the viewer's own", async () => {
    const world = { tokens: { ta: ana }, groups: { [GROUP_A]: { name: "A", people: [ana, ben], messages: [message(7, GROUP_A, { memberId: "ben" })] } } };
    expect((await loadTrips(setup({ ...world, read: { ana: 6 } }), [{ groupId: GROUP_A, token: "ta" }]))[0]).toMatchObject({ unread: true, preview: "Ben: message 7" });
    expect((await loadTrips(setup({ ...world, read: { ana: 7 } }), [{ groupId: GROUP_A, token: "ta" }]))[0].unread).toBe(false);

    const own = { ...world, groups: { [GROUP_A]: { name: "A", people: [ana], messages: [message(8, GROUP_A, { memberId: "ana" })] } } };
    expect((await loadTrips(setup(own), [{ groupId: GROUP_A, token: "ta" }]))[0]).toMatchObject({ unread: false, preview: "You: message 8" });
  });

  it("handles a group nobody has written in", async () => {
    const deps = setup({ tokens: { ta: ana }, groups: { [GROUP_A]: { name: "Quiet", people: [ana] } } });
    expect((await loadTrips(deps, [{ groupId: GROUP_A, token: "ta" }]))[0]).toMatchObject({ preview: null, at: null, unread: false, status: null });
  });

  it("marks who has agreed and says how far the plan is, from the newest plan only", async () => {
    const old: PlanCardSummary = { id: "old", title: "Old", status: "expired", headcount: 2, agreedCount: 0, replacedById: "new" };
    const current: PlanCardSummary = { id: "new", title: "New", status: "reviewing", headcount: 2, agreedCount: 1, replacedById: null };
    const deps = setup({
      tokens: { ta: ana },
      groups: { [GROUP_A]: { name: "A", people: [ana, ben], plans: [old, current] } },
      standing: [person("Ana", { isMe: true }), person("Ben", { agreed: true })],
    });
    expect((await loadTrips(deps, [{ groupId: GROUP_A, token: "ta" }]))[0]).toMatchObject({
      status: { label: "1 of 2 agreed", tone: "success" },
      people: [{ name: "Ana", done: false }, { name: "Ben", done: true }],
    });
  });

  it("names the agent on its messages and leaves system lines unsigned", async () => {
    const agent = message(3, GROUP_A, { kind: "agent", memberId: null, body: "Found a plan" });
    const system = message(4, GROUP_A, { kind: "system", memberId: null, body: "Everyone agreed" });
    const run = (last: Message) => loadTrips(setup({ tokens: { ta: ana }, groups: { [GROUP_A]: { name: "A", people: [ana], messages: [last] } } }), [{ groupId: GROUP_A, token: "ta" }]);
    expect((await run(agent))[0].preview).toBe("Trippy: Found a plan");
    expect((await run(system))[0].preview).toBe("Everyone agreed");
  });
});
