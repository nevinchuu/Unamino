import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresGroupAdminStore } from "./postgres-group-admin-store";
import { PostgresGroupRepository } from "./postgres-group-repository";
import { PostgresMessageRepository } from "./postgres-message-repository";
import { groups, members, messages } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run group-admin-store
 * Everything it creates is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";

describe.skipIf(!ENABLED)("group admin store on the real database", () => {
  let handle: DatabaseHandle;
  let groupRepo: PostgresGroupRepository;
  let messageRepo: PostgresMessageRepository;
  let admin: PostgresGroupAdminStore;
  const created: string[] = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 5);
    groupRepo = new PostgresGroupRepository(handle.db);
    messageRepo = new PostgresMessageRepository(handle.db);
    admin = new PostgresGroupAdminStore(handle.db);
  });

  afterAll(async () => {
    if (!handle) return;
    if (created.length > 0) await handle.db.delete(groups).where(inArray(groups.id, created));
    await handle.close();
  }, 60_000);

  async function groupOfThree() {
    const made = await groupRepo.create({ name: "db-test-group-admin", baseCurrency: "USD", organiser: { displayName: "Ana", currency: "USD" } });
    if (!made.ok) throw new Error(made.error.message);
    created.push(made.value.group.id);
    const joined = [];
    for (const name of ["Ben", "Cai"]) {
      const result = await groupRepo.joinWithLink(made.value.joinToken, { displayName: name, currency: "USD" });
      if (!result.ok) throw new Error(result.error.message);
      joined.push(result.value.member);
    }
    return { group: made.value.group, ana: made.value.organiser, ben: joined[0], cai: joined[1] };
  }

  it("lists a new group as having no plans", async () => {
    const { group } = await groupOfThree();
    expect(await admin.planStatuses(group.id)).toEqual({ ok: true, value: [] });
  }, 30_000);

  it("hands the admin role over in one step, leaving exactly one admin", async () => {
    const { group, ana, ben } = await groupOfThree();
    expect((await admin.transferOrganiser(group.id, ana.id, ben.id)).ok).toBe(true);
    const rows = await handle.db.select().from(members).where(eq(members.groupId, group.id));
    expect(rows.filter((row) => row.isOrganiser).map((row) => row.id)).toEqual([ben.id]);
  }, 30_000);

  it("refuses a hand-over from someone who is not the admin, and changes nothing", async () => {
    const { group, ana, ben, cai } = await groupOfThree();
    expect(await admin.transferOrganiser(group.id, ben.id, cai.id)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const rows = await handle.db.select().from(members).where(eq(members.groupId, group.id));
    expect(rows.filter((row) => row.isOrganiser).map((row) => row.id)).toEqual([ana.id]);
  }, 30_000);

  it("refuses a hand-over to someone who has left", async () => {
    const { group, ana, ben } = await groupOfThree();
    await groupRepo.leave(ben.id);
    expect(await admin.transferOrganiser(group.id, ana.id, ben.id)).toMatchObject({ ok: false, error: { code: "not_found" } });
  }, 30_000);

  it("deletes the group with its members and messages", async () => {
    const { group, ana } = await groupOfThree();
    await messageRepo.post({ groupId: group.id, memberId: ana.id, body: "hello" });
    expect((await admin.deleteGroup(group.id)).ok).toBe(true);
    expect(await handle.db.select().from(groups).where(eq(groups.id, group.id))).toEqual([]);
    expect(await handle.db.select().from(members).where(eq(members.groupId, group.id))).toEqual([]);
    expect(await handle.db.select().from(messages).where(eq(messages.groupId, group.id))).toEqual([]);
  }, 30_000);
});
