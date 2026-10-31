import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import type { PlanStatus } from "@/domain/plan/statuses";
import { flight, hotel } from "@/domain/plan/test-support";
import type { PlanViewRaw } from "@/domain/plan/view-store";
import { handlePlanView, loadPlanViewFor, type PlanViewDeps } from "./plan-view";

const PLAN_ID = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };

const raw = (status: PlanStatus = "reviewing"): PlanViewRaw => ({
  id: PLAN_ID, groupId: GROUP, title: "Bangkok weekend", summary: null, status, deadlineAt: new Date("2026-10-27T01:09:00Z"), baseCurrency: "USD",
  fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, replacedByPlanId: null, trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
  members: [{ id: "ana", name: "Ana", currency: "USD", planAgreement: "pending", approval: "pending", approvedMinor: null, chargedMinor: null, holdPlaced: false }],
  picks: [{ id: "p1", offer: hotel(), memberIds: ["ana"], reason: "r", notes: {} }, { id: "p2", offer: flight(), memberIds: ["ana"], reason: "r", notes: {} }], ideas: [], covers: [], bookings: [],
});

interface Setup {
  status?: PlanStatus;
  member?: Member | null;
  load?: PlanViewDeps["views"]["load"];
}

function setup({ status, member = ana, load }: Setup = {}) {
  const refreshed: string[] = [];
  const loaded: string[] = [];
  const settled: string[] = [];
  const reconciled: string[] = [];
  const caughtUp: string[] = [];
  const deps: PlanViewDeps = {
    views: { load: load ?? (async (id) => (loaded.push(id), ok(raw(status)))) },
    memberOf: async () => member,
    payments: "none",
    scheduleRefresh: (id) => void refreshed.push(id),
    scheduleSettle: (id) => void settled.push(id),
    scheduleReconcile: (plan) => void reconciled.push(plan.id),
    scheduleCatchUp: (id) => void caughtUp.push(id),
  };
  return { deps, refreshed, loaded, settled, reconciled, caughtUp };
}

describe("loadPlanViewFor, recording holds that were never reported", () => {
  it("asks for the holds of a plan that is waiting for them to be checked", async () => {
    const { deps, reconciled } = setup({ status: "approving" });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(reconciled).toEqual([PLAN_ID]);
  });

  it.each<PlanStatus>(["draft", "reviewing", "held", "booking", "booked", "captured", "expired"])("does not ask when the plan is %s", async (status) => {
    const { deps, reconciled } = setup({ status });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(reconciled).toEqual([]);
  });

  it("does not ask for someone who is not in the group", async () => {
    const { deps, reconciled } = setup({ status: "approving", member: null });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(reconciled).toEqual([]);
  });
});

describe("loadPlanViewFor, settling a stuck or never-started booking", () => {
  it("asks for a plan that is booking to be checked for being stuck, and does not refresh its prices", async () => {
    const { deps, settled, refreshed } = setup({ status: "booking" });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(settled).toEqual([PLAN_ID]);
    expect(refreshed).toEqual([]);
  });

  it("asks for a plan that everyone has approved to be checked for a lost request to book", async () => {
    const { deps, settled } = setup({ status: "held" });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(settled).toEqual([PLAN_ID]);
  });

  it("does not ask for a plan in any other state", async () => {
    for (const status of ["draft", "reviewing", "approving", "booked", "captured", "expired"] as const) {
      const { deps, settled } = setup({ status });
      await loadPlanViewFor(deps, PLAN_ID);
      expect(settled, status).toEqual([]);
    }
  });

  it("does not ask for a stranger's view", async () => {
    const { deps, settled } = setup({ status: "held", member: null });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(settled).toEqual([]);
  });
});

describe("loadPlanViewFor", () => {
  it("gives a member their view of the plan, as themselves", async () => {
    const result = await loadPlanViewFor(setup().deps, PLAN_ID);
    expect(result).toMatchObject({ ok: true, view: { id: PLAN_ID, title: "Bangkok weekend", me: { id: "ana", inPlan: true, actions: { agree: true } } } });
  });

  it.each<PlanStatus>(["draft", "reviewing", "approving", "held"])("asks for the prices to be checked again while the plan is %s", async (status) => {
    const { deps, refreshed } = setup({ status });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(refreshed).toEqual([PLAN_ID]);
  });

  it.each<PlanStatus>(["booking", "booked", "captured", "expired"])("leaves the prices alone once the plan is %s", async (status) => {
    const { deps, refreshed } = setup({ status });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(refreshed).toEqual([]);
  });

  it("answers someone who is not in the plan's group exactly as it answers a plan that does not exist, and checks nothing for them", async () => {
    const stranger = setup({ member: null });
    const missing = setup({ load: async () => err({ code: "not_found", message: "no" }) });
    expect(await loadPlanViewFor(stranger.deps, PLAN_ID)).toEqual({ ok: false, reason: "not_found" });
    expect(await loadPlanViewFor(missing.deps, PLAN_ID)).toEqual({ ok: false, reason: "not_found" });
    expect(stranger.refreshed).toEqual([]);
  });

  it("does not even look in the store for an id that is not an id", async () => {
    const { deps, loaded } = setup();
    expect(await loadPlanViewFor(deps, "not-a-uuid'; drop table plans;--")).toEqual({ ok: false, reason: "not_found" });
    expect(loaded).toEqual([]);
  });

  it("tells a storage outage apart from a missing plan", async () => {
    const { deps } = setup({ load: async () => err({ code: "unavailable", message: "db down" }) });
    expect(await loadPlanViewFor(deps, PLAN_ID)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("handlePlanView", () => {
  it("answers 200 with the view, never cached", async () => {
    const response = await handlePlanView(PLAN_ID, setup().deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ id: PLAN_ID, me: { id: "ana" } });
  });

  it("answers 404 for a stranger, and 503 for an outage, without detail", async () => {
    const stranger = await handlePlanView(PLAN_ID, setup({ member: null }).deps);
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toEqual({ error: "not_found" });

    const outage = await handlePlanView(PLAN_ID, setup({ load: async () => err({ code: "unavailable", message: "postgres://secret" }) }).deps);
    expect(outage.status).toBe(503);
    expect(JSON.stringify(await outage.json())).not.toContain("secret");
  });

  it("never sends anything that identifies a person beyond their first name and id in the plan", async () => {
    const body = JSON.stringify(await (await handlePlanView(PLAN_ID, setup().deps)).json());
    expect(body).not.toMatch(/token|hash|inputsHash|password/i);
  });
});

describe("traveller details in the loaded view", () => {
  const MEMBER = { id: "ana", name: "Ana", currency: "USD", planAgreement: "agreed", approval: "approved", approvedMinor: 100, chargedMinor: null, holdPlaced: false } as const;
  const approving = async (travellers: PlanViewDeps["travellers"]) => {
    const { deps } = setup({ status: "approving", load: async () => ok({ ...raw("approving"), members: [MEMBER] }) });
    const loaded = await loadPlanViewFor({ ...deps, payments: "stripe", travellers }, PLAN_ID);
    return loaded.ok ? loaded.view.me.details : null;
  };

  it("asks the person for their details until they are given", async () => {
    expect(await approving({ haveDetails: async () => ok(new Set<string>()) })).toEqual({ needed: true, passportRequired: true });
    expect(await approving({ haveDetails: async () => ok(new Set(["ana"])) })).toMatchObject({ needed: false });
  });

  it("does not ask when details are not taken here, or when the store cannot be reached", async () => {
    expect(await approving(null)).toMatchObject({ needed: false });
    expect(await approving({ haveDetails: async () => err({ kind: "unavailable" as const }) })).toMatchObject({ needed: false });
  });
});

describe("loadPlanViewFor, charges that have not gone through", () => {
  it("asks for the charges of a booked plan to be tried again", async () => {
    const { deps, caughtUp } = setup({ status: "booked" });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(caughtUp).toEqual([PLAN_ID]);
  });

  it.each<PlanStatus>(["draft", "reviewing", "approving", "held", "booking", "captured", "expired"])("does not ask when the plan is %s", async (status) => {
    const { deps, caughtUp } = setup({ status });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(caughtUp).toEqual([]);
  });

  it("does not ask for someone who is not in the group", async () => {
    const { deps, caughtUp } = setup({ status: "booked", member: null });
    await loadPlanViewFor(deps, PLAN_ID);
    expect(caughtUp).toEqual([]);
  });
});
