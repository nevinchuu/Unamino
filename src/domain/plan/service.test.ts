import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import { PlanService, type ActionOutcome } from "./service";
import { agreed, approved, hotel, memberSnapshot, minutesAfter, NOW, ScriptedSource, setup } from "./test-support";

const serviceFor = (s: ReturnType<typeof setup>): PlanService => new PlanService({ ...s.deps, effects: s.effects });

/** An outcome that must have been applied. */
function done(result: Awaited<ReturnType<PlanService["agree"]>>): Extract<ActionOutcome, { status: "done" }> {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
  if (result.value.status !== "done") throw new Error(`not applied: ${result.value.status}`);
  return result.value;
}

const dearHotel = (totalMinor: number) => ({ hotels: [hotel({ id: "h2", totalMinor, expiresAt: minutesAfter(9).toISOString() })] });

describe("PlanService", () => {
  describe("agree", () => {
    it("records the agreement and the price the member saw", async () => {
      const s = setup();
      done(await serviceFor(s).agree("plan-1", "ana", 30_000, NOW));
      expect(s.plans.plan.members[0]).toMatchObject({ planAgreement: "agreed", agreedShareMinor: 30_000 });
      expect(s.plans.plan.members[1].planAgreement).toBe("pending");
    });

    it("opens step 2 when the last member agrees, and runs the effect that asks for approvals", async () => {
      const s = setup({ members: [agreed("ana"), memberSnapshot("ben")] });
      const outcome = done(await serviceFor(s).agree("plan-1", "ben", 30_000, NOW));
      expect(outcome.plan.status).toBe("approving");
      expect(s.effects.types).toEqual(["request_approval"]);
      expect(outcome.effectsFailed).toBe(false);
    });

    it("holds the member to today's price when it is lower than the one they saw", async () => {
      const s = setup({ world: dearHotel(30_000) });
      done(await serviceFor(s).agree("plan-1", "ana", 30_000, NOW));
      expect(s.plans.plan.members[0].agreedShareMinor).toBe(25_000);
    });

    it("accepts a small rise and measures later rises from the price they saw", async () => {
      const s = setup({ world: dearHotel(41_000) });
      done(await serviceFor(s).agree("plan-1", "ana", 30_000, NOW));
      expect(s.plans.plan.members[0].agreedShareMinor).toBe(30_000);
    });

    it("records nothing and reports the new price when it rose by more than 5% since they looked", async () => {
      const s = setup({ world: dearHotel(50_000) });
      const result = await serviceFor(s).agree("plan-1", "ana", 30_000, NOW);
      expect(result).toEqual({ ok: true, value: { status: "price_changed", currentMinor: 35_000 } });
      expect(s.plans.plan.members[0].planAgreement).toBe("pending");
    });

    it("ends the plan instead of recording an agreement when a listing is gone", async () => {
      const s = setup({ world: { flights: [] } });
      const result = await serviceFor(s).agree("plan-1", "ana", 30_000, NOW);
      expect(result.ok && result.value).toMatchObject({ status: "plan_ended", reason: "listing_unavailable" });
      expect(s.plans.plan.status).toBe("expired");
    });

    it("changes nothing and says so when the offers cannot be looked up", async () => {
      const s = setup();
      const before = s.plans.stored;
      const failing = new ScriptedSource(() => err({ code: "source_unavailable", message: "timeout" }));
      const result = await new PlanService({ ...s.deps, source: failing, effects: s.effects }).agree("plan-1", "ana", 30_000, NOW);
      expect(result.ok ? null : result.error.kind).toBe("search_failed");
      expect(s.plans.stored).toBe(before);
    });

    it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses %s as the price the member saw, without searching", async (seen) => {
      const s = setup();
      const result = await serviceFor(s).agree("plan-1", "ana", seen, NOW);
      expect(result.ok ? null : result.error.kind).toBe("invalid_amount");
      expect(s.source.queries).toHaveLength(0);
    });

    it("refuses someone who is not in the plan", async () => {
      const s = setup();
      const result = await serviceFor(s).agree("plan-1", "mallory", 30_000, NOW);
      expect(result.ok ? null : result.error.kind).toBe("unknown_member");
    });

    it("refuses once the plan has moved on to approving", async () => {
      const s = setup({ status: "approving", members: [agreed("ana"), agreed("ben")] });
      const result = await serviceFor(s).agree("plan-1", "ana", 30_000, NOW);
      expect(result.ok ? null : result.error).toMatchObject({ kind: "transition", error: { code: "invalid_status" } });
    });

    it("still records the agreement when an effect fails, and says the effect failed", async () => {
      const s = setup({ members: [agreed("ana"), memberSnapshot("ben")] });
      s.effects.failWith = { message: "disk full" };
      const outcome = done(await serviceFor(s).agree("plan-1", "ben", 30_000, NOW));
      expect(outcome.effectsFailed).toBe(true);
      expect(s.plans.plan.status).toBe("approving");
    });

    it("will not take an agreement on prices that could not be renewed in time", async () => {
      const later = minutesAfter(3);
      const s = setup({ offersCheckedAt: new Date(later.getTime() - 1_000) });
      const result = await serviceFor(s).agree("plan-1", "ana", 30_000, later);
      expect(result.ok ? null : result.error.kind).toBe("prices_stale");
      expect(s.plans.plan.members[0].planAgreement).toBe("pending");
    });

    it("ends the plan when its time has run out past the hard cap", async () => {
      const later = minutesAfter(3);
      const s = setup({ offersCheckedAt: new Date(later.getTime() - 1_000), hardDeadlineAt: minutesAfter(2.5) });
      const result = await serviceFor(s).agree("plan-1", "ana", 30_000, later);
      expect(result.ok && result.value).toMatchObject({ status: "plan_ended", reason: "deadline_passed" });
      expect(s.plans.plan.status).toBe("expired");
    });
  });

  describe("decline", () => {
    it("ends the plan without looking at prices", async () => {
      const s = setup();
      const outcome = done(await serviceFor(s).decline("plan-1", "ben", NOW));
      expect(outcome.plan.status).toBe("expired");
      expect(s.source.queries).toHaveLength(0);
    });
  });

  describe("approveAmount", () => {
    const approving = (extra: Parameters<typeof setup>[0] = {}) => setup({ status: "approving", members: [agreed("ana"), agreed("ben")], ...extra });

    it("caps the member at today's price, asks for a hold of that amount, and lasts until the renewed deadline", async () => {
      const s = approving();
      const outcome = done(await serviceFor(s).approveAmount("plan-1", "ana", 30_000, NOW));
      expect(s.plans.plan.members[0]).toMatchObject({ approval: "approved", approvedMinor: 30_000, currentShareMinor: 30_000, approvalExpiresAt: minutesAfter(9) });
      expect(outcome.effects).toEqual([{ type: "place_hold", memberId: "ana", amountMinor: 30_000 }]);
      expect(s.effects.types).toEqual(["place_hold"]);
    });

    it("sets the cap from today's price, not from the higher price the caller says they saw", async () => {
      const s = approving({ world: dearHotel(30_000) });
      done(await serviceFor(s).approveAmount("plan-1", "ana", 99_999, NOW));
      expect(s.plans.plan.members[0].approvedMinor).toBe(25_000);
    });

    it("approves nothing and reports the new price when it is higher than the one they saw", async () => {
      const s = approving({ world: dearHotel(40_400) });
      const result = await serviceFor(s).approveAmount("plan-1", "ana", 30_000, NOW);
      expect(result).toEqual({ ok: true, value: { status: "price_changed", currentMinor: 30_200 } });
      expect(s.plans.plan.members[0].approval).toBe("pending");
      expect(s.effects.ran.size).toBe(0);
    });

    it("lets a member whose price passed their cap approve the new amount, and nobody else is affected", async () => {
      const s = setup({ status: "approving", members: [approved("ana"), memberSnapshot("ben", { planAgreement: "agreed", agreedShareMinor: 30_000 })], world: dearHotel(50_000) });
      const service = serviceFor(s);
      expect(s.plans.plan.members[0].approval).toBe("approved");

      // The first look moves the price past ana's cap; this is what her page would show.
      const refreshed = await service.refresh("plan-1", NOW);
      expect(refreshed.ok && refreshed.value.status).toBe("refreshed");
      expect(s.plans.plan.members.map((member) => member.approval)).toEqual(["needs_reapproval", "pending"]);

      const outcome = done(await service.approveAmount("plan-1", "ana", 35_000, minutesAfter(1)));
      expect(outcome.plan.members[0]).toMatchObject({ approval: "approved", approvedMinor: 35_000 });
      expect(outcome.plan.members[1].approval).toBe("pending");
    });

    it("refuses before approving opens", async () => {
      const s = setup();
      const result = await serviceFor(s).approveAmount("plan-1", "ana", 30_000, NOW);
      expect(result.ok ? null : result.error).toMatchObject({ kind: "transition", error: { code: "invalid_status" } });
    });

    it("ends the plan when a listing is gone", async () => {
      const s = approving({ world: { hotels: [] } });
      const result = await serviceFor(s).approveAmount("plan-1", "ana", 30_000, NOW);
      expect(result.ok && result.value).toMatchObject({ status: "plan_ended", reason: "listing_unavailable" });
    });
  });

  describe("declineAmount", () => {
    it("ends the plan and gives every placed hold back", async () => {
      const s = setup({ status: "held", members: [approved("ana", { holdPlaced: true }), approved("ben", { holdPlaced: true })] });
      const outcome = done(await serviceFor(s).declineAmount("plan-1", "ben", NOW));
      expect(outcome.plan.status).toBe("expired");
      expect(outcome.effects).toEqual([{ type: "release_holds", memberIds: ["ana", "ben"] }]);
      expect(s.effects.types).toEqual(["release_holds"]);
    });
  });

  describe("refresh", () => {
    it("runs the effects a price rise causes", async () => {
      const s = setup({ members: [agreed("ana"), agreed("ben")], world: dearHotel(50_000) });
      const result = await serviceFor(s).refresh("plan-1", NOW);
      expect(result.ok && result.value).toMatchObject({ status: "refreshed", effectsFailed: false });
      expect(s.effects.types).toEqual(["request_review"]);
    });

    it("runs nothing when it was checked a moment ago", async () => {
      const s = setup({ offersCheckedAt: NOW });
      expect(await serviceFor(s).refresh("plan-1", NOW)).toEqual({ ok: true, value: { status: "skipped", reason: "cooldown", effectsFailed: false } });
    });
  });

  describe("expireOverdue", () => {
    const overdue = (extra: Parameters<typeof setup>[0] = {}) => {
      const s = setup({ status: "approving", members: [agreed("ana"), agreed("ben")], ...extra });
      s.details.pastDeadline = ["plan-1"];
      return s;
    };

    it("does nothing when no plan is overdue", async () => {
      const s = setup();
      expect(await serviceFor(s).expireOverdue(NOW, 50)).toEqual(ok({ checked: 0, expired: 0, renewed: 0, ended: 0, left: 0 }));
    });

    it("ends a plan past its hard cap without looking at the offers", async () => {
      const s = overdue({ hardDeadlineAt: minutesAfter(3) });
      const result = await serviceFor(s).expireOverdue(minutesAfter(5), 50);
      expect(result.ok && result.value).toMatchObject({ checked: 1, expired: 1 });
      expect(s.plans.plan.status).toBe("expired");
      expect(s.source.queries).toHaveLength(0);
    });

    it("renews a plan past its deadline but inside the cap, when its listings are still on sale", async () => {
      const s = overdue();
      const result = await serviceFor(s).expireOverdue(minutesAfter(3), 50);
      expect(result.ok && result.value).toMatchObject({ checked: 1, renewed: 1, expired: 0 });
      expect(s.plans.plan.status).toBe("approving");
      expect(s.plans.plan.deadlineAt).toEqual(minutesAfter(9));
    });

    it("ends a plan inside the cap whose listing is gone", async () => {
      const s = overdue({ world: { flights: [] } });
      const result = await serviceFor(s).expireOverdue(minutesAfter(3), 50);
      expect(result.ok && result.value).toMatchObject({ ended: 1 });
      expect(s.plans.plan.status).toBe("expired");
    });

    it("leaves a plan alone when the offers cannot be looked up, to be tried again next time", async () => {
      const s = overdue();
      const failing = new ScriptedSource(() => err({ code: "source_unavailable", message: "down" }));
      const result = await new PlanService({ ...s.deps, source: failing, effects: s.effects }).expireOverdue(minutesAfter(3), 50);
      expect(result.ok && result.value).toMatchObject({ checked: 1, left: 1 });
      expect(s.plans.plan.status).toBe("approving");
    });
  });
});
