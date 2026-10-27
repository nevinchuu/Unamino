import { afterEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import type { PlanStatus } from "@/domain/plan/statuses";
import { flight, hotel } from "@/domain/plan/test-support";
import type { PlanViewRaw } from "@/domain/plan/view-store";
import type { TravellerService } from "@/domain/travellers/service";
import { runSaveTravellerDetails, type TravellerActionDeps } from "./traveller-actions";

const PLAN_ID = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };
const FORM = { firstName: "Daniel" };
const SAVE_FAILED = { ok: false, error: "Couldn't save your details. Try again in a moment." };
const NOT_FOUND = { ok: false, error: "We couldn't find that plan." };

const plan = (overrides: Partial<PlanViewRaw> = {}): PlanViewRaw => ({
  id: PLAN_ID, groupId: GROUP, title: "t", summary: null, status: "approving", deadlineAt: new Date("2026-10-27T01:09:00Z"), baseCurrency: "USD",
  fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, replacedByPlanId: null, trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
  members: [{ id: "ana", name: "Ana", currency: "USD", planAgreement: "agreed", approval: "approved", approvedMinor: 100, chargedMinor: null, holdPlaced: false }],
  picks: [{ id: "f", offer: flight(), memberIds: ["ana"], reason: "r", notes: {} }, { id: "h", offer: hotel(), memberIds: ["ana"], reason: "r", notes: {} }], ideas: [],
  ...overrides,
});

function setup(options: { plan?: PlanViewRaw; save?: TravellerService["save"]; none?: boolean; storeDown?: boolean } = {}) {
  const saves: unknown[][] = [];
  const save: TravellerService["save"] = options.save ?? (async (...args) => (saves.push(args), ok(undefined)));
  const deps: TravellerActionDeps = {
    travellers: options.none ? null : { save },
    views: { load: async () => (options.storeDown ? err({ code: "unavailable" as const, message: "db" }) : ok(options.plan ?? plan())) },
  };
  return { deps, saves };
}

afterEach(() => vi.restoreAllMocks());

describe("runSaveTravellerDetails", () => {
  it("saves for the signed-in person only, and works out the passport rule from the plan", async () => {
    const { deps, saves } = setup();
    expect(await runSaveTravellerDetails(deps, ana, PLAN_ID, FORM)).toEqual({ ok: true });
    expect(saves).toEqual([["ana", FORM, { passportRequired: true }]]);
  });

  it("does not ask a hotel-only person for a passport", async () => {
    const { deps, saves } = setup({ plan: plan({ picks: [{ id: "h", offer: hotel(), memberIds: ["ana"], reason: "r", notes: {} }] }) });
    await runSaveTravellerDetails(deps, ana, PLAN_ID, FORM);
    expect(saves[0][2]).toEqual({ passportRequired: false });
  });

  it("refuses someone not signed in, a bad id, and a plan in another group, giving nothing away", async () => {
    const { deps, saves } = setup();
    expect(await runSaveTravellerDetails(deps, null, PLAN_ID, FORM)).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    expect(await runSaveTravellerDetails(deps, ana, "not-an-id", FORM)).toEqual(NOT_FOUND);
    expect(await runSaveTravellerDetails(setup({ plan: plan({ groupId: "other" }) }).deps, ana, PLAN_ID, FORM)).toEqual(NOT_FOUND);
    expect(saves).toEqual([]);
  });

  it("refuses a member who is not in the plan", async () => {
    const outsider = { ...ana, id: "zed" };
    expect(await runSaveTravellerDetails(setup().deps, outsider, PLAN_ID, FORM)).toEqual({ ok: false, error: "You are not part of this plan." });
  });

  it.each<PlanStatus>(["draft", "reviewing", "booking", "booked", "captured", "expired"])("takes nothing while the plan is %s", async (status) => {
    const { deps, saves } = setup({ plan: plan({ status }) });
    expect(await runSaveTravellerDetails(deps, ana, PLAN_ID, FORM)).toEqual({ ok: false, error: "This plan isn't asking for details right now." });
    expect(saves).toEqual([]);
  });

  it.each<PlanStatus>(["approving", "held"])("takes details while the plan is %s", async (status) => {
    expect(await runSaveTravellerDetails(setup({ plan: plan({ status }) }).deps, ana, PLAN_ID, FORM)).toEqual({ ok: true });
  });

  it("passes back what to fix, field by field", async () => {
    const save: TravellerService["save"] = async () => err({ kind: "invalid", fields: { birthday: "Your date of birth must be in the past." } });
    expect(await runSaveTravellerDetails(setup({ save }).deps, ana, PLAN_ID, FORM)).toEqual({ ok: false, error: "Check the fields marked below.", fields: { birthday: "Your date of birth must be in the past." } });
  });

  it("says so when details are not set up here", async () => {
    expect(await runSaveTravellerDetails(setup({ none: true }).deps, ana, PLAN_ID, FORM)).toEqual({ ok: false, error: "Traveller details are not set up on this server." });
  });

  it("gives no internal reason when the details store or the plan store is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const down: TravellerService["save"] = async () => err({ kind: "unavailable" });
    expect(await runSaveTravellerDetails(setup({ save: down }).deps, ana, PLAN_ID, FORM)).toEqual(SAVE_FAILED);
    expect(await runSaveTravellerDetails(setup({ storeDown: true }).deps, ana, PLAN_ID, FORM)).toEqual(SAVE_FAILED);
  });
});
