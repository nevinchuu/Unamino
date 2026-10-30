import { describe, expect, it } from "vitest";
import { CoverService, type CoverOutcome } from "./cover-service";
import { currentShares } from "./pricing";
import { PlanService } from "./service";
import { agreed, approved, memberSnapshot, MemoryCoverStore, NOW, setup } from "./test-support";

/** Three people share the hotel and the flight: $600 in all, so the parts are $200.01, $200.00 and $199.99 (spare cents go to the first). */
function threeWay(options: Parameters<typeof setup>[0] = {}) {
  const s = setup({ members: [memberSnapshot("ana"), memberSnapshot("ben"), memberSnapshot("cai")], ...options });
  const covers = new MemoryCoverStore(s.details);
  const service = new CoverService({ plans: s.plans, details: s.details, covers, effects: s.effects, clock: () => NOW });
  return { ...s, covers, service };
}

const changed = (result: Awaited<ReturnType<CoverService["set"]>>): Extract<CoverOutcome, { status: "changed" }> => {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
  if (result.value.status !== "changed") throw new Error(`not changed: ${result.value.status}`);
  return result.value;
};

const errorKind = (result: Awaited<ReturnType<CoverService["set"]>>): string | null => (result.ok ? null : result.error.kind);

/** What this person's card pays at the plan's stored prices. */
const pays = (s: ReturnType<typeof threeWay>, memberId: string): number => {
  const shares = currentShares(s.details.details, s.details.details.picks);
  if (!shares.ok) throw new Error(shares.error.message);
  return shares.value.find((share) => share.memberId === memberId)?.shareMinor ?? -1;
};

describe("CoverService", () => {
  describe("set", () => {
    it("moves a fixed part of one share onto the friend, and sends everyone back to look", async () => {
      const s = threeWay({ status: "approving", members: [agreed("ana"), agreed("ben"), agreed("cai")] });
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "amount", amountBaseMinor: 5_000 }));
      expect(s.details.details.covers).toEqual([{ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: 5_000 }]);
      expect(s.plans.plan.status).toBe("reviewing");
      expect(s.plans.plan.members.every((member) => member.planAgreement === "pending")).toBe(true);
      expect(s.effects.types).toEqual(["request_review"]);
    });

    it("covers the whole share, which takes the covered person to nothing", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "all" }));
      expect(pays(s, "ben")).toBe(0);
      expect(pays(s, "ana")).toBe(40_001);
      expect(pays(s, "cai")).toBe(19_999);
    });

    it("covers a percent of the share, which follows the price", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "percent", percent: 50 }));
      expect(s.details.details.covers).toEqual([{ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: null, sharePercent: 50 }]);
      expect(pays(s, "ben")).toBeGreaterThan(0);
      expect(pays(s, "ana") + pays(s, "ben") + pays(s, "cai")).toBe(60_000);
    });

    it("says nothing changed when the same percent is asked for again", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "percent", percent: 50 }));
      const again = await s.service.set("plan-1", "ana", "ben", { kind: "percent", percent: 50 });
      expect(again).toEqual({ ok: true, value: { status: "unchanged" } });
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "percent", percent: 25 }));
    });

    it("refuses a percent outside 1 to 99", async () => {
      const s = threeWay();
      expect(errorKind(await s.service.set("plan-1", "ana", "ben", { kind: "percent", percent: 100 }))).toBe("invalid");
      expect(s.details.details.covers).toEqual([]);
    });

    it("lets go of the holds of people who had approved, because their amounts changed", async () => {
      const s = threeWay({ status: "approving", members: [approved("ana"), memberSnapshot("ben", { planAgreement: "agreed" }), memberSnapshot("cai", { planAgreement: "agreed" })] });
      changed(await s.service.set("plan-1", "cai", "ben", { kind: "all" }));
      expect([...s.effects.ran.values()]).toContainEqual({ type: "release_holds", memberIds: ["ana"] });
    });

    it("changes the amount when the same friend covers the same person again", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "amount", amountBaseMinor: 5_000 }));
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "all" }));
      expect(s.details.details.covers).toEqual([{ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: null }]);
    });

    it("does nothing, and keeps everyone's agreement, when it is already exactly like that", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "all" }));
      const before = s.plans.stored;
      expect(await s.service.set("plan-1", "ana", "ben", { kind: "all" })).toEqual({ ok: true, value: { status: "unchanged" } });
      expect(s.plans.stored).toBe(before);
    });

    it("refuses more than the person's own share, and says how much that is", async () => {
      const s = threeWay();
      const result = await s.service.set("plan-1", "ana", "ben", { kind: "amount", amountBaseMinor: 20_001 });
      expect(result).toMatchObject({ ok: false, error: { kind: "too_much", ownPartBaseMinor: 20_000 } });
      expect(s.details.details.covers).toEqual([]);
      expect(s.plans.saves).toBe(0);
    });

    it("refuses covering yourself", async () => {
      const s = threeWay();
      expect(errorKind(await s.service.set("plan-1", "ana", "ana", { kind: "all" }))).toBe("invalid");
    });

    it("refuses a chain: someone being covered cannot cover somebody else", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "all" }));
      expect(errorKind(await s.service.set("plan-1", "ben", "cai", { kind: "all" }))).toBe("invalid");
      expect(s.details.details.covers).toHaveLength(1);
    });

    it("refuses someone who is not in the plan", async () => {
      const s = threeWay();
      expect(errorKind(await s.service.set("plan-1", "ana", "stranger", { kind: "all" }))).toBe("not_in_plan");
    });

    it.each(["held", "booking", "booked", "captured", "expired"] as const)("refuses once the plan is %s, and changes nothing", async (status) => {
      const s = threeWay({ status });
      expect(errorKind(await s.service.set("plan-1", "ana", "ben", { kind: "all" }))).toBe("not_open");
      expect(s.details.details.covers).toEqual([]);
    });

    it("puts the covers back as they were when the plan cannot be reset", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "amount", amountBaseMinor: 5_000 }));
      s.plans.saveFailure = { code: "unavailable", message: "down" };
      expect(errorKind(await s.service.set("plan-1", "ana", "ben", { kind: "all" }))).toBe("unavailable");
      expect(s.details.details.covers).toEqual([{ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: 5_000 }]);
    });

    it("removes a cover it just made when the plan cannot be reset", async () => {
      const s = threeWay();
      s.plans.saveFailure = { code: "unavailable", message: "down" };
      expect(errorKind(await s.service.set("plan-1", "ana", "ben", { kind: "all" }))).toBe("unavailable");
      expect(s.details.details.covers).toEqual([]);
    });

    it("says so when letting go of the holds did not all go through, but the cover stands", async () => {
      const s = threeWay();
      s.effects.failWith = { message: "stripe down" };
      expect(changed(await s.service.set("plan-1", "ana", "ben", { kind: "all" })).effectsFailed).toBe(true);
      expect(s.details.details.covers).toHaveLength(1);
    });
  });

  describe("remove", () => {
    it("takes the cover back and sends everyone back to look", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "all" }));
      const result = await s.service.remove("plan-1", "ana", "ben");
      expect(result).toEqual({ ok: true, value: { status: "changed", effectsFailed: false } });
      expect(s.details.details.covers).toEqual([]);
      expect(pays(s, "ben")).toBe(20_000);
    });

    it("is quiet when there was nothing to remove", async () => {
      const s = threeWay();
      expect(await s.service.remove("plan-1", "ana", "ben")).toEqual({ ok: true, value: { status: "unchanged" } });
      expect(s.plans.saves).toBe(0);
    });

    it("restores the cover when the plan cannot be reset", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "all" }));
      s.plans.saveFailure = { code: "unavailable", message: "down" };
      await s.service.remove("plan-1", "ana", "ben");
      expect(s.details.details.covers).toHaveLength(1);
    });
  });

  describe("with the plan service", () => {
    it("lets a fully covered person agree and approve at nothing, and charges the friend for both", async () => {
      const s = threeWay();
      changed(await s.service.set("plan-1", "ana", "ben", { kind: "all" }));
      const plan = new PlanService({ ...s.deps, effects: s.effects });

      expect((await plan.agree("plan-1", "ben", 0, NOW)).ok).toBe(true);
      expect((await plan.agree("plan-1", "ana", 40_001, NOW)).ok).toBe(true);
      expect((await plan.agree("plan-1", "cai", 19_999, NOW)).ok).toBe(true);
      expect(s.plans.plan.status).toBe("approving");

      expect((await plan.approveAmount("plan-1", "ben", 0, NOW)).ok).toBe(true);
      const anaApproval = await plan.approveAmount("plan-1", "ana", 40_001, NOW);
      expect(anaApproval).toMatchObject({ ok: true, value: { status: "done" } });
      const members = s.plans.plan.members;
      expect(members.map((member) => member.approvedMinor)).toEqual([40_001, 0, null]);
      expect(s.effects.types.filter((type) => type === "place_hold")).toHaveLength(1);
    });

    it("shows the friend a higher price than they agreed when they try to approve the old one", async () => {
      const s = threeWay();
      const plan = new PlanService({ ...s.deps, effects: s.effects });
      for (const id of ["ana", "ben", "cai"]) await plan.agree("plan-1", id, 20_000, NOW);
      const result = await plan.approveAmount("plan-1", "ana", 20_000, NOW);
      expect(result.ok).toBe(true);
    });
  });
});
