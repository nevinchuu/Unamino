import { afterEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import type { CardForm, ConfirmOutcome, HoldFailure } from "@/domain/payments/hold-service";
import { describeHoldFailure, runCardForm, runConfirmHold, type HoldActionDeps } from "./hold-actions";

const PLAN_ID = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };
const FORM: CardForm = { holdId: "pi_1", clientSecret: "pi_1_secret_abc", amountMinor: 29_009, currency: "USD", status: "awaiting_card" };

function setup(options: { holds?: HoldActionDeps["holds"]; planGroup?: string | null; storeDown?: boolean } = {}) {
  const calls: unknown[][] = [];
  const holds: HoldActionDeps["holds"] =
    options.holds === undefined
      ? {
          ensureHold: async (...args: unknown[]) => (calls.push(["ensureHold", ...args]), ok(FORM)),
          confirmHold: async (...args: unknown[]) => (calls.push(["confirmHold", ...args]), ok({ status: "placed" } as ConfirmOutcome)),
        }
      : options.holds;
  const deps: HoldActionDeps = {
    holds,
    views: { groupIdOf: async () => (options.storeDown ? err({ code: "unavailable" as const, message: "db" }) : ok(options.planGroup === undefined ? GROUP : options.planGroup)) },
  };
  return { deps, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("runCardForm", () => {
  it("hands the signed-in person the card form for their own hold, asking for nobody else's", async () => {
    const { deps, calls } = setup();
    expect(await runCardForm(deps, ana, PLAN_ID)).toEqual({ ok: true, clientSecret: "pi_1_secret_abc", amountMinor: 29_009, currency: "USD", status: "awaiting_card" });
    expect(calls).toEqual([["ensureHold", PLAN_ID, "ana"]]);
  });

  it("refuses someone who is not signed in, someone from another group, a plan that does not exist and an id that is not an id, giving nothing away", async () => {
    const { deps, calls } = setup();
    expect(await runCardForm(deps, null, PLAN_ID)).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    expect(await runCardForm(setup({ planGroup: "another-group" }).deps, ana, PLAN_ID)).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(await runCardForm(setup({ planGroup: null }).deps, ana, PLAN_ID)).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(await runCardForm(deps, ana, "x'; drop table plans;--")).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(calls).toEqual([]);
  });

  it("says so when this server does not take real card holds", async () => {
    expect(await runCardForm(setup({ holds: null }).deps, ana, PLAN_ID)).toEqual({ ok: false, error: "Card payments are not set up on this server." });
  });

  it("says the store is down without detail", async () => {
    expect(await runCardForm(setup({ storeDown: true }).deps, ana, PLAN_ID)).toMatchObject({ ok: false, error: expect.stringContaining("Try again") });
  });

  it("turns a failure into plain words and logs only its kind, never the provider's message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const holds: HoldActionDeps["holds"] = { ensureHold: async () => err({ kind: "payment", message: "Invalid API Key provided: sk_test_***abc" }), confirmHold: async () => ok({ status: "placed" } as ConfirmOutcome) };
    const result = await runCardForm(setup({ holds }).deps, ana, PLAN_ID);
    expect(result).toEqual({ ok: false, error: "Couldn't reach the payment service. Try again in a moment." });
    expect(JSON.stringify(result)).not.toContain("sk_test");
    expect(log).toHaveBeenCalledWith("card form failed", "payment");
  });
});

describe("runConfirmHold", () => {
  it.each<ConfirmOutcome["status"]>(["placed", "waiting", "gone"])("passes on that the hold is %s", async (status) => {
    const holds: HoldActionDeps["holds"] = { ensureHold: async () => ok(FORM), confirmHold: async () => ok(status === "waiting" ? { status, reason: "Your card was declined." } : ({ status } as ConfirmOutcome)) };
    expect(await runConfirmHold(setup({ holds }).deps, ana, PLAN_ID)).toEqual({ ok: true, outcome: status });
  });

  it("never passes the provider's reason for a refused card on to the browser", async () => {
    const holds: HoldActionDeps["holds"] = { ensureHold: async () => ok(FORM), confirmHold: async () => ok({ status: "waiting", reason: "card_declined: insufficient_funds on card ending 4242" }) };
    expect(JSON.stringify(await runConfirmHold(setup({ holds }).deps, ana, PLAN_ID))).not.toMatch(/4242|insufficient|declined/);
  });

  it("confirms the signed-in person's own hold only", async () => {
    const { deps, calls } = setup();
    await runConfirmHold(deps, ana, PLAN_ID);
    expect(calls).toEqual([["confirmHold", PLAN_ID, "ana"]]);
  });

  it("refuses the same people the card form refuses", async () => {
    const { deps, calls } = setup();
    expect(await runConfirmHold(deps, null, PLAN_ID)).toMatchObject({ ok: false });
    expect(await runConfirmHold(setup({ planGroup: "another-group" }).deps, ana, PLAN_ID)).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(calls).toEqual([]);
  });

  it("reports a mismatch as such, and any other failure as the service being unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = (kind: HoldFailure["kind"]) => setup({ holds: { ensureHold: async () => ok(FORM), confirmHold: async () => err({ kind, message: "internal" }) } }).deps;
    expect(await runConfirmHold(failing("mismatch"), ana, PLAN_ID)).toMatchObject({ ok: false, error: expect.stringContaining("doesn't match") });
    for (const kind of ["payment", "store", "plan"] as const) expect(await runConfirmHold(failing(kind), ana, PLAN_ID)).toMatchObject({ ok: false, error: expect.stringContaining("Try again in a moment") });
  });
});

describe("describeHoldFailure", () => {
  it("never repeats the internal message", () => {
    for (const kind of ["not_applicable", "payment", "store", "mismatch", "plan"] as const) {
      expect(describeHoldFailure({ kind, message: "postgres://secret and sk_test_abc" })).not.toMatch(/postgres|sk_test/);
    }
  });
});
