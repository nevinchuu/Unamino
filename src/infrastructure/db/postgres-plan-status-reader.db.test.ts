import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresPlanStatusReader } from "./postgres-plan-status-reader";
import { groups, members, planMembers, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-plan-status-reader
 * Everything it creates hangs off one group that is deleted afterwards. It uses made-up people only.
 */
const ENABLED = process.env.DB_TESTS === "1";
const DEADLINE = new Date("2026-10-27T00:09:00.000Z");

describe.skipIf(!ENABLED)("PostgresPlanStatusReader on the real database", () => {
  let handle: DatabaseHandle;
  let groupId: string;
  let planId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 4);
    const [group] = await handle.db.insert(groups).values({ name: "db-test-group", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    const memberIds: string[] = [];
    for (const name of ["ana", "ben", "jia"]) {
      const [row] = await handle.db.insert(members).values({ groupId, displayName: name, currency: "USD", status: "joined", joinedAt: new Date(), inviteTokenHash: randomUUID() }).returning({ id: members.id });
      memberIds.push(row.id);
    }
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: 3 }).returning({ id: tripBriefs.id });
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId: brief.id, status: "approving", title: "Test", deadlineAt: DEADLINE, hardDeadlineAt: new Date("2026-10-29T00:00:00Z"), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 3, inputsHash: "test" })
      .returning({ id: plans.id });
    planId = plan.id;
    await handle.db.insert(planMembers).values([
      { planId, memberId: memberIds[0], planAgreement: "agreed", approval: "approved", approvedMinor: 30_000 },
      { planId, memberId: memberIds[1], planAgreement: "agreed" },
      { planId, memberId: memberIds[2] },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("counts members, agreements and approvals, and gives the state and deadline", async () => {
    const result = await new PostgresPlanStatusReader(handle.db).read(planId);
    expect(result).toEqual({ ok: true, value: { status: "approving", memberCount: 3, agreedCount: 2, approvedCount: 1, deadlineAt: DEADLINE } });
  }, 30_000);

  it("exposes no amounts, names or ids beyond what the endpoint shows", async () => {
    const result = await new PostgresPlanStatusReader(handle.db).read(planId);
    if (!result.ok) throw new Error(result.error.message);
    expect(Object.keys(result.value).sort()).toEqual(["agreedCount", "approvedCount", "deadlineAt", "memberCount", "status"]);
  }, 30_000);

  it("reports a plan that does not exist", async () => {
    const result = await new PostgresPlanStatusReader(handle.db).read(randomUUID());
    expect(result.ok ? null : result.error.code).toBe("not_found");
  }, 30_000);
});
