import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { ConfirmOutcome, HoldFailure } from "@/domain/payments/hold-service";
import type { PlanStatus } from "@/domain/plan/statuses";
import type { ViewMember } from "@/domain/plan/view-store";
import type { Result } from "@/lib/result";
import { HoldReconciler, RECONCILE_GAP_MS } from "./hold-reconcile";

const member = (id: string, overrides: Partial<ViewMember> = {}): ViewMember => ({ id, name: id, currency: "USD", planAgreement: "agreed", approval: "approved", approvedMinor: 6_422, chargedMinor: null, holdPlaced: false, ...overrides });
const plan = (status: PlanStatus, members: ViewMember[]) => ({ id: "plan-1", status, members });

function setup(answer: (memberId: string) => Result<ConfirmOutcome, HoldFailure> = () => ok({ status: "placed" })) {
  let now = new Date("2026-11-01T10:00:00Z").getTime();
  const asked: string[] = [];
  const reconciler = new HoldReconciler({
    holds: { confirmHold: async (_plan, memberId) => (asked.push(memberId), answer(memberId)) },
    clock: () => new Date(now),
  });
  return { reconciler, asked, advance: (ms: number) => (now += ms) };
}

describe("HoldReconciler", () => {
  it("asks about everyone who approved but has no hold recorded, and says how many it recorded", async () => {
    const { reconciler, asked } = setup((id) => (id === "cai" ? ok({ status: "waiting", reason: null }) : ok({ status: "placed" })));
    const recorded = await reconciler.reconcile(plan("approving", [member("ana"), member("ben"), member("cai"), member("dee", { holdPlaced: true }), member("eli", { approval: "pending" })]));
    expect(asked).toEqual(["ana", "ben", "cai"]);
    expect(recorded).toBe(2);
  });

  it.each<PlanStatus>(["draft", "reviewing", "held", "booking", "booked", "captured", "expired"])("does nothing for a plan that is %s", async (status) => {
    const { reconciler, asked } = setup();
    expect(await reconciler.reconcile(plan(status, [member("ana")]))).toBe(0);
    expect(asked).toEqual([]);
  });

  it("leaves a plan alone for a short while after checking it, then checks it again", async () => {
    const { reconciler, asked, advance } = setup();
    await reconciler.reconcile(plan("approving", [member("ana")]));
    advance(RECONCILE_GAP_MS - 1_000);
    await reconciler.reconcile(plan("approving", [member("ana")]));
    expect(asked).toEqual(["ana"]);
    advance(2_000);
    await reconciler.reconcile(plan("approving", [member("ana")]));
    expect(asked).toEqual(["ana", "ana"]);
  });

  it("carries on with the others when the provider or the database cannot be reached for one person", async () => {
    const { reconciler, asked } = setup((id) => (id === "ana" ? err({ kind: "payment", message: "stripe down" }) : ok({ status: "placed" })));
    expect(await reconciler.reconcile(plan("approving", [member("ana"), member("ben")]))).toBe(1);
    expect(asked).toEqual(["ana", "ben"]);
  });

  it("counts a hold the plan has moved on from as not recorded", async () => {
    const { reconciler } = setup(() => ok({ status: "gone" }));
    expect(await reconciler.reconcile(plan("approving", [member("ana")]))).toBe(0);
  });
});
