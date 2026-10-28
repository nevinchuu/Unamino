import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresTravellerStore } from "./postgres-traveller-store";
import { groups, members, travellerDetails } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-traveller-store
 * Everything it creates hangs off one group that is deleted afterwards. It stores made-up text only, never real details.
 */
const ENABLED = process.env.DB_TESTS === "1";

describe.skipIf(!ENABLED)("PostgresTravellerStore on the real database", () => {
  let handle: DatabaseHandle;
  let store: PostgresTravellerStore;
  let groupId: string;
  let ana: string;
  let ben: string;

  const newMember = async (name: string): Promise<string> => {
    const [member] = await handle.db.insert(members).values({ groupId, displayName: name, currency: "USD", status: "joined", joinedAt: new Date(), inviteTokenHash: randomUUID() }).returning({ id: members.id });
    return member.id;
  };

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
    store = new PostgresTravellerStore(handle.db);
    const [group] = await handle.db.insert(groups).values({ name: "db-test-travellers", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    ana = await newMember("ana");
    ben = await newMember("ben");
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("keeps a value, replaces it when saved again, and returns null for someone with none", async () => {
    expect(await store.get(ana)).toEqual({ ok: true, value: null });
    await store.put(ana, "v1.first");
    await store.put(ana, "v1.second");
    expect(await store.get(ana)).toEqual({ ok: true, value: "v1.second" });
    expect(await store.get(ben)).toEqual({ ok: true, value: null });
  }, 30_000);

  it("says who has details, and answers an empty question with nothing", async () => {
    await store.put(ana, "v1.x");
    expect(await store.haveDetails([ana, ben])).toEqual({ ok: true, value: [ana] });
    expect(await store.haveDetails([])).toEqual({ ok: true, value: [] });
  }, 30_000);

  it("deletes the rows for good, and deleting ones that are not there is fine", async () => {
    await store.put(ana, "v1.x");
    await store.put(ben, "v1.y");
    expect(await store.remove([ana, ben, randomUUID()])).toEqual({ ok: true, value: undefined });
    expect(await handle.db.select().from(travellerDetails).where(eq(travellerDetails.memberId, ana))).toHaveLength(0);
    expect(await store.remove([])).toEqual({ ok: true, value: undefined });
  }, 30_000);

  it("deletes a member's details when the member is deleted", async () => {
    const carl = await newMember("carl");
    await store.put(carl, "v1.z");
    await handle.db.delete(members).where(eq(members.id, carl));
    expect(await store.get(carl)).toEqual({ ok: true, value: null });
  }, 30_000);

  it("deletes only the details saved before a moment, and giving them again starts the age over", async () => {
    const [oldMember, freshMember] = [ana, ben];
    await store.remove([oldMember, freshMember]);
    await store.put(oldMember, "old");
    await store.put(freshMember, "fresh");
    await handle.db.update(travellerDetails).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(travellerDetails.memberId, oldMember));

    // The cutoff is before this project existed, so only the rows this test aged by hand can match it.
    const removed = await store.removeOlderThan(new Date("2026-02-01T00:00:00Z"));
    expect(removed).toEqual({ ok: true, value: 1 });
    expect(await store.get(oldMember)).toEqual({ ok: true, value: null });
    expect(await store.get(freshMember)).toEqual({ ok: true, value: "fresh" });

    // Saved again, an old row is young again.
    await handle.db.update(travellerDetails).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(travellerDetails.memberId, freshMember));
    await store.put(freshMember, "fresh again");
    expect(await store.removeOlderThan(new Date("2026-02-01T00:00:00Z"))).toEqual({ ok: true, value: 0 });
  }, 30_000);
});
