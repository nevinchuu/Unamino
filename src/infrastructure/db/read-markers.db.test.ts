import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresGroupRepository } from "./postgres-group-repository";
import { PostgresMessageRepository } from "./postgres-message-repository";
import { PostgresReadMarkers } from "./postgres-read-markers";
import { groups } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run read-markers
 * Everything it creates is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";

describe.skipIf(!ENABLED)("read markers on the real database", () => {
  let handle: DatabaseHandle;
  let groupRepo: PostgresGroupRepository;
  let messageRepo: PostgresMessageRepository;
  let markers: PostgresReadMarkers;
  const created: string[] = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 5);
    groupRepo = new PostgresGroupRepository(handle.db);
    messageRepo = new PostgresMessageRepository(handle.db);
    markers = new PostgresReadMarkers(handle.db);
  });

  afterAll(async () => {
    if (!handle) return;
    if (created.length > 0) await handle.db.delete(groups).where(inArray(groups.id, created));
    await handle.close();
  }, 60_000);

  async function newGroupWithMessage() {
    const made = await groupRepo.create({ name: "db-test-read-markers", baseCurrency: "USD", organiser: { displayName: "Nevin", currency: "USD" } });
    if (!made.ok) throw new Error(made.error.message);
    created.push(made.value.group.id);
    const posted = await messageRepo.post({ groupId: made.value.group.id, memberId: made.value.organiser.id, body: "hello" });
    if (!posted.ok) throw new Error(posted.error.message);
    return { member: made.value.organiser, seq: posted.value.seq };
  }

  it("starts a new member at nothing read", async () => {
    const { member } = await newGroupWithMessage();
    expect((await markers.lastRead([member.id])).get(member.id)).toBe(0);
  }, 30_000);

  it("moves forward to the newest message read, and never back", async () => {
    const { member, seq } = await newGroupWithMessage();
    await markers.markRead(member.id, seq);
    expect((await markers.lastRead([member.id])).get(member.id)).toBe(seq);

    await markers.markRead(member.id, seq - 1);
    expect((await markers.lastRead([member.id])).get(member.id)).toBe(seq);
  }, 30_000);

  it("answers for several people at once, and for none", async () => {
    const a = await newGroupWithMessage();
    const b = await newGroupWithMessage();
    await markers.markRead(b.member.id, b.seq);
    const read = await markers.lastRead([a.member.id, b.member.id]);
    expect([read.get(a.member.id), read.get(b.member.id)]).toEqual([0, b.seq]);
    expect((await markers.lastRead([])).size).toBe(0);
  }, 30_000);
});
