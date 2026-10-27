import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import type { ActionOutcome, PlanService, ServiceError } from "@/domain/plan/service";
import type { PlanSnapshot } from "@/domain/plan/types";
import { describeServiceError, runPlanAction, type PlanActionDeps, type PlanActionName } from "./plan-actions";

const PLAN_ID = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const NOW = new Date("2026-10-27T01:00:00Z");
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };
const SNAPSHOT: PlanSnapshot = { status: "reviewing", deadlineAt: NOW, hardDeadlineAt: NOW, members: [] };

type Call = { method: string; args: unknown[] };
const done: ActionOutcome = { status: "done", plan: SNAPSHOT, effects: [], effectsFailed: false };

function setup(options: { outcome?: Awaited<ReturnType<PlanService["agree"]>>; planGroup?: string | null; storeDown?: boolean } = {}) {
  const calls: Call[] = [];
  const said: string[] = [];
  const answer = options.outcome ?? ok(done);
  const record = (method: string) => async (...args: unknown[]) => (calls.push({ method, args }), answer);
  const deps: PlanActionDeps = {
    plans: { agree: record("agree"), decline: record("decline"), approveAmount: record("approveAmount"), declineAmount: record("declineAmount") } as unknown as PlanActionDeps["plans"],
    views: { groupIdOf: async () => (options.storeDown ? err({ code: "unavailable", message: "db" }) : ok(options.planGroup === undefined ? GROUP : options.planGroup)) },
    messages: { postSystem: async (_group, body) => (said.push(body), ok({ id: "m", seq: 1, groupId: GROUP, memberId: null, kind: "system" as const, body, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: NOW })) },
    clock: () => NOW,
  };
  return { deps, calls, said };
}

const run = (deps: PlanActionDeps, action: PlanActionName, member: Member | null = ana, seenMinor?: number) => runPlanAction(deps, member, { planId: PLAN_ID, action, seenMinor });

describe("runPlanAction", () => {
  it.each([
    ["agree", "agree", [PLAN_ID, "ana", 29_000, NOW]],
    ["approve", "approveAmount", [PLAN_ID, "ana", 29_000, NOW]],
  ] as const)("%s: passes the price the person saw, never an amount of their own", async (action, method, args) => {
    const { deps, calls } = setup();
    expect(await run(deps, action, ana, 29_000)).toEqual({ ok: true, outcome: "done" });
    expect(calls).toEqual([{ method, args }]);
  });

  it.each([
    ["decline", "decline"],
    ["declineAmount", "declineAmount"],
  ] as const)("%s: needs no price", async (action, method) => {
    const { deps, calls } = setup();
    expect((await run(deps, action)).ok).toBe(true);
    expect(calls).toEqual([{ method, args: [PLAN_ID, "ana", NOW] }]);
  });

  it.each<PlanActionName>(["agree", "approve"])("%s: refuses without a price, without asking the service", async (action) => {
    const { deps, calls } = setup();
    expect(await run(deps, action, ana, undefined)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("refuses someone who is not signed in, someone from another group, and an id that is not an id", async () => {
    const { deps, calls } = setup();
    expect(await run(deps, "agree", null, 1)).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    expect(await run(setup({ planGroup: "another-group" }).deps, "agree", ana, 1)).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(await run(setup({ planGroup: null }).deps, "agree", ana, 1)).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(await runPlanAction(deps, ana, { planId: "x'; drop table plans;--", action: "decline" })).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(calls).toEqual([]);
  });

  it("says so, without detail, when the store is down", async () => {
    expect(await run(setup({ storeDown: true }).deps, "decline")).toEqual({ ok: false, error: "Something went wrong on our side. Try again in a moment." });
  });

  it("passes on a price that rose since the person looked, and posts nothing", async () => {
    const { deps, said } = setup({ outcome: ok({ status: "price_changed", currentMinor: 31_000 }) });
    expect(await run(deps, "approve", ana, 29_000)).toEqual({ ok: true, outcome: "price_changed", currentMinor: 31_000 });
    expect(said).toEqual([]);
  });

  it("tells the group when the plan ended because a listing went, or time ran out", async () => {
    const gone = setup({ outcome: ok({ status: "plan_ended", plan: SNAPSHOT, reason: "listing_unavailable", effectsFailed: false }) });
    expect(await run(gone.deps, "agree", ana, 1)).toEqual({ ok: true, outcome: "plan_ended", reason: "listing_unavailable" });
    expect(gone.said[0]).toMatch(/no longer available, so the plan has ended. Mention @trippy/);

    const late = setup({ outcome: ok({ status: "plan_ended", plan: SNAPSHOT, reason: "deadline_passed", effectsFailed: false }) });
    await run(late.deps, "approve", ana, 1);
    expect(late.said[0]).toMatch(/ran out of time/);
  });

  it("tells the group who declined, in their own name, and how to start again", async () => {
    const declined = setup();
    await run(declined.deps, "decline");
    expect(declined.said).toEqual(["Ana declined the plan, so it has ended. Mention @trippy to start a new one."]);

    const backedOut = setup();
    await run(backedOut.deps, "declineAmount");
    expect(backedOut.said[0]).toMatch(/^Ana backed out, so the plan has ended and any card holds were released/);
  });

  it("says nothing in the chat for an ordinary agree or approve, which the plan card already shows", async () => {
    const agreed = setup();
    await run(agreed.deps, "agree", ana, 1);
    await run(agreed.deps, "approve", ana, 1);
    expect(agreed.said).toEqual([]);
  });

  it("turns a refusal into plain words and never shows the internal reason", async () => {
    const refused: ServiceError = { kind: "transition", error: { code: "invalid_status", message: "approve is not allowed while the plan is reviewing" } };
    const result = await run(setup({ outcome: err(refused) }).deps, "approve", ana, 1);
    expect(result).toEqual({ ok: false, error: "The plan has moved on, so that can't be done now. The screen will show where it stands." });
    expect(JSON.stringify(result)).not.toContain("invalid_status");
  });
});

describe("describeServiceError", () => {
  const cases: [ServiceError, RegExp][] = [
    [{ kind: "transition", error: { code: "invalid_status", message: "x" } }, /moved on/],
    [{ kind: "transition", error: { code: "plan_closed", message: "x" } }, /moved on/],
    [{ kind: "transition", error: { code: "unknown_member", message: "x" } }, /not part of this plan/],
    [{ kind: "unknown_member", message: "x" }, /not part of this plan/],
    [{ kind: "search_failed", message: "timeout" }, /latest prices/],
    [{ kind: "prices_stale", message: "x" }, /latest prices/],
    [{ kind: "pricing_failed", message: "x" }, /worked out/],
    [{ kind: "invalid_amount", message: "x" }, /didn't look right/],
    [{ kind: "repository", error: { code: "unavailable", message: "postgres://secret" } }, /our side/],
  ];

  it.each(cases)("has plain words for %j", (error, pattern) => {
    const message = describeServiceError(error);
    expect(message).toMatch(pattern);
    expect(message).not.toMatch(/postgres|timeout|invalid_|unavailable/);
  });
});
