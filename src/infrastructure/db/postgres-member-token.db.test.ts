import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresGroupRepository } from "./postgres-group-repository";
import { groups, members } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-member-token
 * Everything it creates is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";

describe.skipIf(!ENABLED)("a member's secret on the real database", () => {
  let handle: DatabaseHandle;
  let repo: PostgresGroupRepository;
  const created: string[] = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
    repo = new PostgresGroupRepository(handle.db);
  });

  afterAll(async () => {
    if (!handle) return;
    if (created.length > 0) await handle.db.delete(groups).where(inArray(groups.id, created));
    await handle.close();
  }, 60_000);

  async function groupWithFriend() {
    const made = await repo.create({ name: "db-test-access", baseCurrency: "USD", organiser: { displayName: "Ana", currency: "USD" } });
    if (!made.ok) throw new Error(made.error.message);
    created.push(made.value.group.id);
    const joined = await repo.joinWithLink(made.value.joinToken, { displayName: "Ben", currency: "USD" });
    if (!joined.ok) throw new Error(joined.error.message);
    return { admin: made.value, friend: joined.value };
  }

  it("signs in with the new secret and not the old one", async () => {
    const { friend } = await groupWithFriend();
    const replaced = await repo.replaceMemberToken(friend.member.id);
    if (!replaced.ok) throw new Error(replaced.error.message);

    expect(replaced.value).not.toBe(friend.memberToken);
    expect(await repo.authenticate(replaced.value)).toMatchObject({ ok: true, value: { id: friend.member.id, displayName: "Ben" } });
    expect(await repo.authenticate(friend.memberToken)).toMatchObject({ ok: false });
  }, 30_000);

  it("leaves everyone else's secret alone", async () => {
    const { admin, friend } = await groupWithFriend();
    await repo.replaceMemberToken(friend.member.id);
    expect(await repo.authenticate(admin.memberToken)).toMatchObject({ ok: true, value: { id: admin.organiser.id } });
  }, 30_000);

  it("never stores the secret, only its hash", async () => {
    const { friend } = await groupWithFriend();
    const replaced = await repo.replaceMemberToken(friend.member.id);
    if (!replaced.ok) throw new Error(replaced.error.message);
    const [row] = await handle.db.select().from(members).where(eq(members.id, friend.member.id));
    expect(row.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(replaced.value);
  }, 30_000);

  it("gives nothing to someone who has left, and signs nobody in through a secret they once had", async () => {
    const { friend } = await groupWithFriend();
    const replaced = await repo.replaceMemberToken(friend.member.id);
    if (!replaced.ok) throw new Error(replaced.error.message);
    await repo.leave(friend.member.id);

    expect(await repo.replaceMemberToken(friend.member.id)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await repo.authenticate(replaced.value)).toMatchObject({ ok: false });
  }, 30_000);

  it("refuses a member who does not exist", async () => {
    expect(await repo.replaceMemberToken("00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, error: { code: "not_found" } });
  }, 30_000);
});
