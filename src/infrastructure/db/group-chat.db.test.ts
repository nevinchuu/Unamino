import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_GROUP_MEMBERS, type Member } from "@/domain/group/types";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresGroupRepository } from "./postgres-group-repository";
import { PostgresMessageRepository } from "./postgres-message-repository";
import { groups, members, messages } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run group-chat
 * Everything it creates is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const ME = { displayName: "Ana", currency: "USD" };

describe.skipIf(!ENABLED)("groups and chat on the real database", () => {
  let handle: DatabaseHandle;
  let groupRepo: PostgresGroupRepository;
  let messageRepo: PostgresMessageRepository;
  const created: string[] = [];

  async function newGroup(name = "db-test-group") {
    const result = await groupRepo.create({ name, baseCurrency: "USD", organiser: { displayName: "Nevin", currency: "USD" } });
    if (!result.ok) throw new Error(result.error.message);
    created.push(result.value.group.id);
    return result.value;
  }

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 10);
    groupRepo = new PostgresGroupRepository(handle.db);
    messageRepo = new PostgresMessageRepository(handle.db);
  });

  afterAll(async () => {
    if (!handle) return;
    if (created.length > 0) await handle.db.delete(groups).where(inArray(groups.id, created));
    await handle.close();
  }, 60_000);

  describe("creating and joining", () => {
    it("makes the creator the organiser and the only person in the group", async () => {
      const { group, organiser, memberToken, joinToken } = await newGroup();
      expect(organiser.isOrganiser).toBe(true);
      expect((await groupRepo.joinedMembers(group.id)).map((m) => m.id)).toEqual([organiser.id]);
      expect(memberToken).not.toEqual(joinToken);
    }, 30_000);

    it("never stores either secret, only hashes", async () => {
      const { group, memberToken, joinToken } = await newGroup();
      const [row] = await handle.db.select().from(groups).where(eq(groups.id, group.id));
      const stored = await handle.db.select().from(members).where(eq(members.groupId, group.id));
      expect(row.joinTokenHash).not.toContain(joinToken);
      expect(JSON.stringify(stored)).not.toContain(memberToken);
      expect(row.joinTokenHash).toMatch(/^[0-9a-f]{64}$/);
    }, 30_000);

    it("lets someone join with the shared link and recognises them afterwards", async () => {
      const { group, joinToken } = await newGroup();
      const joined = await groupRepo.joinWithLink(joinToken, ME);
      if (!joined.ok) throw new Error(joined.error.message);
      expect(joined.value.member).toMatchObject({ displayName: "Ana", currency: "USD", isOrganiser: false, groupId: group.id });

      const who = await groupRepo.authenticate(joined.value.memberToken);
      expect(who.ok && who.value.id).toBe(joined.value.member.id);
      expect(await groupRepo.joinedMembers(group.id)).toHaveLength(2);
    }, 30_000);

    it("lists people in the order they joined", async () => {
      const { group, joinToken } = await newGroup();
      for (const name of ["Ana", "Ben", "Jia"]) await groupRepo.joinWithLink(joinToken, { displayName: name, currency: "USD" });
      expect((await groupRepo.joinedMembers(group.id)).map((m) => m.displayName)).toEqual(["Nevin", "Ana", "Ben", "Jia"]);
    }, 30_000);

    it("refuses a link that does not exist, and bad details", async () => {
      expect((await groupRepo.joinWithLink("not-a-real-link", ME)).ok).toBe(false);
      const { joinToken } = await newGroup();
      for (const person of [{ displayName: "  ", currency: "USD" }, { displayName: "x".repeat(41), currency: "USD" }, { displayName: "Ana", currency: "usd" }]) {
        const result = await groupRepo.joinWithLink(joinToken, person);
        expect(result.ok ? null : result.error.code).toBe("invalid_input");
      }
    }, 30_000);

    it("lets a link be looked at without using it, and shows only the group, the inviter and how many are in", async () => {
      const { group, joinToken } = await newGroup("Bangkok weekend");
      const ana = await groupRepo.joinWithLink(joinToken, ME);
      if (!ana.ok) throw new Error(ana.error.message);

      const preview = await groupRepo.describeJoinLink(joinToken);
      expect(preview).toEqual({ ok: true, value: { groupId: group.id, groupName: "Bangkok weekend", inviterName: "Nevin", memberCount: 2, isFull: false } });
      expect(JSON.stringify(preview)).not.toContain("Ana");
      expect(await groupRepo.joinedMembers(group.id)).toHaveLength(2);
    }, 30_000);

    it("reports a full group in the preview, and refuses links that are unknown or switched off", async () => {
      const { group, organiser, joinToken } = await newGroup();
      for (let i = 1; i < MAX_GROUP_MEMBERS; i += 1) await groupRepo.joinWithLink(joinToken, { displayName: `Friend ${i}`, currency: "USD" });
      const full = await groupRepo.describeJoinLink(joinToken);
      expect(full.ok && full.value).toMatchObject({ memberCount: MAX_GROUP_MEMBERS, isFull: true });

      expect((await groupRepo.disableJoinLink(group.id, organiser.id)).ok).toBe(true);
      const off = await groupRepo.describeJoinLink(joinToken);
      expect(off.ok ? null : off.error.code).toBe("invalid_link");
      const unknown = await groupRepo.describeJoinLink("nonsense");
      expect(unknown.ok ? null : unknown.error.code).toBe("invalid_link");
    }, 60_000);

    it("does not recognise a wrong token", async () => {
      const result = await groupRepo.authenticate("nonsense");
      expect(result.ok ? null : result.error.code).toBe("not_found");
    });

    it("stops a group growing past its limit", async () => {
      const { group, joinToken } = await newGroup();
      for (let i = 1; i < MAX_GROUP_MEMBERS; i += 1) {
        const r = await groupRepo.joinWithLink(joinToken, { displayName: `Friend ${i}`, currency: "USD" });
        if (!r.ok) throw new Error(r.error.message);
      }
      expect(await groupRepo.joinedMembers(group.id)).toHaveLength(MAX_GROUP_MEMBERS);
      const extra = await groupRepo.joinWithLink(joinToken, ME);
      expect(extra.ok ? null : extra.error.code).toBe("group_full");
    }, 60_000);

    it("gives the last place to only one of two people who take it at the same moment", async () => {
      const { group, joinToken } = await newGroup();
      for (let i = 1; i < MAX_GROUP_MEMBERS - 1; i += 1) await groupRepo.joinWithLink(joinToken, { displayName: `Friend ${i}`, currency: "USD" });
      expect(await groupRepo.joinedMembers(group.id)).toHaveLength(MAX_GROUP_MEMBERS - 1);

      const results = await Promise.all([groupRepo.joinWithLink(joinToken, { displayName: "Racer A", currency: "USD" }), groupRepo.joinWithLink(joinToken, { displayName: "Racer B", currency: "USD" })]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.error.code === "group_full")).toHaveLength(1);
      expect(await groupRepo.joinedMembers(group.id)).toHaveLength(MAX_GROUP_MEMBERS);
    }, 90_000);
  });

  describe("leaving and the join link", () => {
    it("removes someone from the headcount and from recognition when they leave, keeping their history", async () => {
      const { group, joinToken } = await newGroup();
      const ana = await groupRepo.joinWithLink(joinToken, ME);
      if (!ana.ok) throw new Error(ana.error.message);
      expect((await groupRepo.leave(ana.value.member.id)).ok).toBe(true);

      expect(await groupRepo.joinedMembers(group.id)).toHaveLength(1);
      expect((await groupRepo.authenticate(ana.value.memberToken)).ok).toBe(false);
      const [row] = await handle.db.select().from(members).where(eq(members.id, ana.value.member.id));
      expect(row.status).toBe("left");
      expect(row.leftAt).not.toBeNull();
    }, 30_000);

    it("keeps the names of people who left, for the messages they wrote", async () => {
      const { group, organiser, joinToken } = await newGroup();
      const ana = await groupRepo.joinWithLink(joinToken, ME);
      if (!ana.ok) throw new Error(ana.error.message);
      expect((await groupRepo.leave(ana.value.member.id)).ok).toBe(true);

      const names = await groupRepo.memberNames(group.id);
      expect(names.get(organiser.id)).toBe("Nevin");
      expect(names.get(ana.value.member.id)).toBe("Ana");
      expect(names.size).toBe(2);
      expect((await groupRepo.memberNames((await newGroup()).group.id)).has(ana.value.member.id)).toBe(false);
    }, 30_000);

    it("does not let the organiser leave their own group", async () => {
      const { organiser } = await newGroup();
      const result = await groupRepo.leave(organiser.id);
      expect(result.ok ? null : result.error.code).toBe("forbidden");
    }, 30_000);

    it("lets the organiser switch the link off and replace it, and nobody else", async () => {
      const { group, organiser, joinToken } = await newGroup();
      const ana = await groupRepo.joinWithLink(joinToken, ME);
      if (!ana.ok) throw new Error(ana.error.message);

      const byMember = await groupRepo.disableJoinLink(group.id, ana.value.member.id);
      expect(byMember.ok ? null : byMember.error.code).toBe("forbidden");
      expect((await groupRepo.replaceJoinLink(group.id, ana.value.member.id)).ok).toBe(false);

      expect((await groupRepo.disableJoinLink(group.id, organiser.id)).ok).toBe(true);
      const blocked = await groupRepo.joinWithLink(joinToken, { displayName: "Late", currency: "USD" });
      expect(blocked.ok ? null : blocked.error.code).toBe("invalid_link");

      const fresh = await groupRepo.replaceJoinLink(group.id, organiser.id);
      if (!fresh.ok) throw new Error(fresh.error.message);
      expect((await groupRepo.joinWithLink(joinToken, { displayName: "Old link", currency: "USD" })).ok).toBe(false);
      expect((await groupRepo.joinWithLink(fresh.value, { displayName: "New link", currency: "USD" })).ok).toBe(true);
    }, 60_000);
  });

  describe("messages", () => {
    async function groupWithAna(): Promise<{ groupId: string; nevin: Member; ana: Member }> {
      const { group, organiser, joinToken } = await newGroup();
      const ana = await groupRepo.joinWithLink(joinToken, ME);
      if (!ana.ok) throw new Error(ana.error.message);
      return { groupId: group.id, nevin: organiser, ana: ana.value.member };
    }

    it("stores a person's message and marks it as calling the agent only when it does", async () => {
      const { groupId, nevin } = await groupWithAna();
      const plain = await messageRepo.post({ groupId, memberId: nevin.id, body: "sounds good" });
      const call = await messageRepo.post({ groupId, memberId: nevin.id, body: "@trippy plan Bangkok" });
      expect(plain.ok && plain.value.mentionsAgent).toBe(false);
      expect(call.ok && call.value.mentionsAgent).toBe(true);
      expect(call.ok && call.value.kind).toBe("human");
    }, 30_000);

    it("counts a reply to the agent as a call, so a group can answer its questions", async () => {
      const { groupId, nevin } = await groupWithAna();
      const question = await messageRepo.postAgent(groupId, "Which dates work?");
      if (!question.ok) throw new Error(question.error.message);
      const reply = await messageRepo.post({ groupId, memberId: nevin.id, body: "the 11th to the 13th", replyToMessageId: question.value.id });
      expect(reply.ok && reply.value.mentionsAgent).toBe(true);
    }, 30_000);

    it("never lets the agent or the system call the agent", async () => {
      const { groupId } = await groupWithAna();
      const agent = await messageRepo.postAgent(groupId, "@trippy loop forever");
      const system = await messageRepo.postSystem(groupId, "@trippy joined");
      expect(agent.ok && agent.value.mentionsAgent).toBe(false);
      expect(system.ok && system.value.mentionsAgent).toBe(false);
    }, 30_000);

    it("refuses someone outside the group, someone who has left, and a reply into another group", async () => {
      const { groupId, nevin, ana } = await groupWithAna();
      const other = await newGroup("db-test-other");
      const stranger = await messageRepo.post({ groupId, memberId: other.organiser.id, body: "hello" });
      expect(stranger.ok ? null : stranger.error.code).toBe("forbidden");

      const elsewhere = await messageRepo.postSystem(other.group.id, "private to the other group");
      if (!elsewhere.ok) throw new Error(elsewhere.error.message);
      const crossed = await messageRepo.post({ groupId, memberId: nevin.id, body: "hi", replyToMessageId: elsewhere.value.id });
      expect(crossed.ok ? null : crossed.error.code).toBe("invalid_input");

      await groupRepo.leave(ana.id);
      const gone = await messageRepo.post({ groupId, memberId: ana.id, body: "still here?" });
      expect(gone.ok ? null : gone.error.code).toBe("forbidden");
    }, 60_000);

    it("refuses empty and oversized messages and trims the rest", async () => {
      const { groupId, nevin } = await groupWithAna();
      for (const body of ["", "   ", "x".repeat(4001)]) {
        const result = await messageRepo.post({ groupId, memberId: nevin.id, body });
        expect(result.ok ? null : result.error.code).toBe("invalid_input");
      }
      const trimmed = await messageRepo.post({ groupId, memberId: nevin.id, body: "  hello  " });
      expect(trimmed.ok && trimmed.value.body).toBe("hello");
    }, 30_000);

    it("lists messages in order, newer than a given point, for polling", async () => {
      const { groupId, nevin } = await groupWithAna();
      const sent = [];
      for (const body of ["one", "two", "three"]) {
        const r = await messageRepo.post({ groupId, memberId: nevin.id, body });
        if (!r.ok) throw new Error(r.error.message);
        sent.push(r.value);
      }
      expect((await messageRepo.listAfter(groupId, 0, 50)).map((m) => m.body)).toEqual(["one", "two", "three"]);
      expect((await messageRepo.listAfter(groupId, sent[0].seq, 50)).map((m) => m.body)).toEqual(["two", "three"]);
      expect(await messageRepo.listAfter(groupId, sent[2].seq, 50)).toEqual([]);
      expect((await messageRepo.listAfter(groupId, 0, 2)).map((m) => m.body)).toEqual(["one", "two"]);
    }, 30_000);

    it("gives the latest messages oldest first, and keeps groups apart", async () => {
      const { groupId, nevin } = await groupWithAna();
      const other = await newGroup("db-test-other-2");
      for (const body of ["a", "b", "c", "d"]) await messageRepo.post({ groupId, memberId: nevin.id, body });
      await messageRepo.postSystem(other.group.id, "not ours");
      expect((await messageRepo.recent(groupId, 3)).map((m) => m.body)).toEqual(["b", "c", "d"]);
    }, 30_000);

    it("lets the database refuse an agent message that claims to call the agent", async () => {
      const { groupId } = await groupWithAna();
      const attempt = handle.db.insert(messages).values({ groupId, kind: "agent", body: "x", mentionsAgent: true });
      await expect(attempt).rejects.toThrow();
    }, 30_000);
  });
});
