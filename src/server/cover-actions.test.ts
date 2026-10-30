import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import type { CoverError, CoverOutcome, CoverService } from "@/domain/plan/cover-service";
import { flight, hotel } from "@/domain/plan/test-support";
import type { PlanViewRaw } from "@/domain/plan/view-store";
import { describeCoverError, runCoverAction, type CoverActionDeps, type CoverChange } from "./cover-actions";

const PLAN_ID = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const BEN_ID = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };

const person = (id: string, name: string): PlanViewRaw["members"][number] => ({ id, name, currency: "USD", planAgreement: "pending", approval: "pending", approvedMinor: null, chargedMinor: null, holdPlaced: false });

const plan = (overrides: Partial<PlanViewRaw> = {}): PlanViewRaw => ({
  id: PLAN_ID, groupId: GROUP, title: "t", summary: null, status: "reviewing", deadlineAt: new Date("2026-10-27T01:09:00Z"), baseCurrency: "USD",
  fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 2, replacedByPlanId: null, trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
  members: [person("ana", "Ana"), person(BEN_ID, "Ben")],
  picks: [{ id: "f", offer: flight(), memberIds: ["ana", BEN_ID], reason: "r", notes: {} }, { id: "h", offer: hotel(), memberIds: ["ana", BEN_ID], reason: "r", notes: {} }], ideas: [], covers: [], bookings: [],
  ...overrides,
});

type Call = { method: string; args: unknown[] };

function setup(options: { plan?: PlanViewRaw; answer?: Awaited<ReturnType<CoverService["set"]>>; storeDown?: boolean } = {}) {
  const calls: Call[] = [];
  const said: string[] = [];
  const answer = options.answer ?? ok<CoverOutcome>({ status: "changed", effectsFailed: false });
  const record = (method: string) => async (...args: unknown[]) => (calls.push({ method, args }), answer);
  const deps: CoverActionDeps = {
    covers: { set: record("set"), remove: record("remove") } as unknown as CoverActionDeps["covers"],
    views: { load: async () => (options.storeDown ? err({ code: "unavailable" as const, message: "db" }) : ok(options.plan ?? plan())) },
    messages: { postSystem: async (_group, body) => (said.push(body), ok({ id: "m", seq: 1, groupId: GROUP, memberId: null, kind: "system" as const, body, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: new Date() })) },
  };
  return { deps, calls, said };
}

const run = (deps: CoverActionDeps, change: CoverChange, member: Member | null = ana, beneficiaryId = BEN_ID) => runCoverAction(deps, member, { planId: PLAN_ID, beneficiaryId, change });

describe("runCoverAction", () => {
  it("covers the whole share for the signed-in person, and tells the group by name", async () => {
    const { deps, calls, said } = setup();
    expect(await run(deps, { kind: "all" })).toEqual({ ok: true, outcome: "changed" });
    expect(calls).toEqual([{ method: "set", args: [PLAN_ID, "ana", BEN_ID, { kind: "all" }] }]);
    expect(said).toEqual(["Ana is covering Ben's whole share."]);
  });

  it("covers a fixed amount and says how much", async () => {
    const { deps, calls, said } = setup();
    await run(deps, { kind: "amount", amountMinor: 6_000 });
    expect(calls[0].args[3]).toEqual({ kind: "amount", amountBaseMinor: 6_000 });
    expect(said).toEqual(["Ana is covering $60.00 of Ben's share."]);
  });

  it("covers half and says half", async () => {
    const { deps, calls, said } = setup();
    await run(deps, { kind: "percent", percent: 50 });
    expect(calls[0].args[3]).toEqual({ kind: "percent", percent: 50 });
    expect(said).toEqual(["Ana is covering half of Ben's share."]);
  });

  it("names any other percent", async () => {
    const { deps, said } = setup();
    await run(deps, { kind: "percent", percent: 25 });
    expect(said).toEqual(["Ana is covering 25% of Ben's share."]);
  });

  it.each([0, 100, 12.5, Number.NaN])("refuses %s as a percent, without asking the service", async (percent) => {
    const { deps, calls } = setup();
    expect(await run(deps, { kind: "percent", percent })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("stops covering and says so", async () => {
    const { deps, calls, said } = setup();
    await run(deps, { kind: "stop" });
    expect(calls).toEqual([{ method: "remove", args: [PLAN_ID, "ana", BEN_ID] }]);
    expect(said).toEqual(["Ana is no longer covering Ben's share."]);
  });

  it("says nothing in the chat when nothing changed", async () => {
    const { deps, said } = setup({ answer: ok<CoverOutcome>({ status: "unchanged" }) });
    expect(await run(deps, { kind: "all" })).toEqual({ ok: true, outcome: "unchanged" });
    expect(said).toEqual([]);
  });

  it("never takes the sponsor from the request: it is always the signed-in person", async () => {
    const { deps, calls } = setup();
    await run(deps, { kind: "all" });
    expect(calls[0].args[1]).toBe("ana");
  });

  it.each([0, -5, 1.5, Number.NaN])("refuses %s as an amount, without asking the service", async (amountMinor) => {
    const { deps, calls } = setup();
    expect(await run(deps, { kind: "amount", amountMinor })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("refuses someone not signed in, bad ids, and a plan in another group, giving nothing away", async () => {
    const { deps, calls } = setup();
    expect(await run(deps, { kind: "all" }, null)).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    expect(await runCoverAction(deps, ana, { planId: "nope", beneficiaryId: BEN_ID, change: { kind: "all" } })).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(await run(deps, { kind: "all" }, ana, "nope")).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(await run(setup({ plan: plan({ groupId: "other" }) }).deps, { kind: "all" })).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(calls).toEqual([]);
  });

  it("refuses a person who is not in the plan, and a beneficiary who is not", async () => {
    const { deps } = setup();
    expect(await run(deps, { kind: "all" }, { ...ana, id: "zed" })).toEqual({ ok: false, error: "You're not part of this plan." });
    expect(await run(deps, { kind: "all" }, ana, "9f0a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c")).toEqual({ ok: false, error: "They aren't part of this plan." });
  });

  it("passes a refusal on in plain words and says nothing in the chat", async () => {
    const answer = err<CoverError>({ kind: "not_open", message: "internal" });
    const { deps, said } = setup({ answer });
    expect(await run(deps, { kind: "all" })).toEqual({ ok: false, error: "The plan has moved on, so who pays what can't change now." });
    expect(said).toEqual([]);
  });

  it("answers plainly when the plan cannot be read", async () => {
    expect(await run(setup({ storeDown: true }).deps, { kind: "all" })).toEqual({ ok: false, error: "Something went wrong on our side. Try again in a moment." });
  });
});

describe("describeCoverError", () => {
  it("says how much the most is, in the plan's money", () => {
    expect(describeCoverError({ kind: "too_much", message: "x", ownPartBaseMinor: 12_345 }, "USD")).toBe("That's more than their share, which is $123.45.");
  });

  it("shows the plain reason for something not allowed", () => {
    expect(describeCoverError({ kind: "invalid", message: "Nobody can cover their own share" }, "USD")).toBe("Nobody can cover their own share");
  });
});
