import { describe, expect, it } from "vitest";
import { applyPlanEvent } from "@/domain/plan/apply-event";
import type { PlanStatus } from "@/domain/plan/statuses";
import { approved, DEADLINE, HARD, MemoryEffectRunner, MemoryPlanRepository, memberSnapshot, NOW } from "@/domain/plan/test-support";
import type { HoldCapture, MemberSnapshot, PlanEffect } from "@/domain/plan/types";
import { HoldService } from "./hold-service";
import { MemoryPaymentProvider } from "./memory-provider";
import { MemoryHoldStore } from "./test-support";

const PLAN = "plan-1";

function setup(options: { status?: PlanStatus; members?: MemberSnapshot[] } = {}) {
  const plans = new MemoryPlanRepository({ id: PLAN, version: 1, plan: { status: options.status ?? "approving", deadlineAt: DEADLINE, hardDeadlineAt: HARD, members: options.members ?? [approved("ana"), approved("ben")] } });
  const provider = new MemoryPaymentProvider();
  const store = new MemoryHoldStore(plans);
  const effects = new MemoryEffectRunner();
  const service = new HoldService({ provider, store, plans, effects: () => effects, clock: () => NOW });
  /** What the person's browser does: confirm the card on the hold that was made for them. */
  const placeCard = (memberId: string) => provider.completeCard(store.holdIdOf(PLAN, memberId) as string);
  const form = async (memberId: string) => {
    const result = await service.ensureHold(PLAN, memberId);
    if (!result.ok) throw new Error(`no card form: ${result.error.message}`);
    return result.value;
  };
  return { plans, provider, store, effects, service, placeCard, form };
}

describe("ensureHold", () => {
  it("makes a hold for exactly what the person approved, in their currency, for them in this plan, and says what the card form needs", async () => {
    const s = setup();
    const form = await s.form("ana");
    expect(form).toMatchObject({ amountMinor: 30_000, currency: "USD", status: "awaiting_card", clientSecret: expect.any(String) });
    expect(s.provider.all()).toMatchObject([{ amountMinor: 30_000, currency: "USD", owner: { planId: PLAN, memberId: "ana" }, status: "awaiting_card" }]);
    expect(s.store.holdIdOf(PLAN, "ana")).toBe(form.holdId);
  });

  it("gives the same hold when asked again, without making a second one", async () => {
    const s = setup();
    const first = await s.form("ana");
    const again = await s.form("ana");
    expect(again.holdId).toBe(first.holdId);
    expect(s.provider.all()).toHaveLength(1);
  });

  it("ends up with one hold when asked twice at the same moment", async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.service.ensureHold(PLAN, "ana"), s.service.ensureHold(PLAN, "ana")]);
    expect(a.ok && b.ok && a.value.holdId === b.value.holdId).toBe(true);
    expect(s.provider.all()).toHaveLength(1);
  });

  it("says a card is already on the hold when it is, so only confirming is left", async () => {
    const s = setup();
    await s.form("ana");
    s.placeCard("ana");
    expect(await s.form("ana")).toMatchObject({ status: "held" });
  });

  it("does not make a hold when none is needed: before step 2, before the person approves, or once the hold is recorded", async () => {
    const cases: [string, ReturnType<typeof setup>][] = [
      ["reviewing", setup({ status: "reviewing" })],
      ["not approved", setup({ members: [memberSnapshot("ana", { planAgreement: "agreed", agreedShareMinor: 30_000 })] })],
      ["already placed", setup({ members: [approved("ana", { holdPlaced: true })] })],
      ["expired", setup({ status: "expired" })],
    ];
    for (const [label, s] of cases) {
      expect(await s.service.ensureHold(PLAN, "ana"), label).toMatchObject({ ok: false, error: { kind: "not_applicable" } });
      expect(s.provider.all(), label).toEqual([]);
    }
  });

  it("does not make a hold for someone who is not in the plan", async () => {
    expect(await setup().service.ensureHold(PLAN, "mallory")).toMatchObject({ ok: false, error: { kind: "store" } });
  });

  it("starts again with a new hold when the old one is for another amount, letting the old one go first", async () => {
    const s = setup();
    const old = await s.form("ana");
    // The person approved a higher amount since, and the old hold was never let go of.
    await applyPlanEvent(s.plans, PLAN, { type: "price_rechecked", at: NOW, memberId: "ana", currentMinor: 35_000 });
    await applyPlanEvent(s.plans, PLAN, { type: "member_approved", at: NOW, memberId: "ana", amountMinor: 35_000, expiresAt: DEADLINE });

    const next = await s.form("ana");
    expect(next.holdId).not.toBe(old.holdId);
    expect(next.amountMinor).toBe(35_000);
    expect(s.provider.all().map((h) => [h.id, h.status])).toEqual([[old.holdId, "released"], [next.holdId, "awaiting_card"]]);
  });

  it("makes a new hold after the old one was let go of, instead of reusing the released one", async () => {
    const s = setup();
    const old = await s.form("ana");
    await s.service.releaseHolds(PLAN, ["ana"]);
    const next = await s.form("ana");
    expect(next.holdId).not.toBe(old.holdId);
    expect(next.status).toBe("awaiting_card");
  });

  it("reports the provider being down, and keeps nothing", async () => {
    const s = setup();
    s.provider.outages.add("createHold");
    expect(await s.service.ensureHold(PLAN, "ana")).toMatchObject({ ok: false, error: { kind: "payment" } });
    expect(s.store.holdIdOf(PLAN, "ana")).toBeNull();
  });

  it("reports the database being down, without calling the provider", async () => {
    const s = setup();
    s.store.down = true;
    expect(await s.service.ensureHold(PLAN, "ana")).toMatchObject({ ok: false, error: { kind: "store" } });
    expect(s.provider.calls).toEqual([]);
  });
});

describe("confirmHold", () => {
  it("waits when the card has not been confirmed, and says why when it was refused", async () => {
    const s = setup();
    const { holdId } = await s.form("ana");
    expect(await s.service.confirmHold(PLAN, "ana")).toEqual({ ok: true, value: { status: "waiting", reason: null } });
    s.provider.failCard(holdId, "Your card has insufficient funds.");
    expect(await s.service.confirmHold(PLAN, "ana")).toEqual({ ok: true, value: { status: "waiting", reason: "Your card has insufficient funds." } });
    expect(s.plans.plan.members[0].holdPlaced).toBe(false);
  });

  it("records the hold once the provider says it is set aside, and the plan waits for the others", async () => {
    const s = setup();
    await s.form("ana");
    s.placeCard("ana");
    expect(await s.service.confirmHold(PLAN, "ana")).toEqual({ ok: true, value: { status: "placed" } });
    expect(s.plans.plan.members.map((m) => m.holdPlaced)).toEqual([true, false]);
    expect(s.plans.plan.status).toBe("approving");
    expect(s.effects.types).toEqual([]);
  });

  it("moves the plan on and hands over the booking effect when the last hold is placed", async () => {
    const s = setup();
    for (const id of ["ana", "ben"]) {
      await s.form(id);
      s.placeCard(id);
      await s.service.confirmHold(PLAN, id);
    }
    expect(s.plans.plan.status).toBe("held");
    expect(s.effects.types).toEqual(["book"]);
  });

  it("is the same when asked twice, as when the webhook and the browser both report the same hold", async () => {
    const s = setup();
    await s.form("ana");
    s.placeCard("ana");
    const results = await Promise.all([s.service.confirmHold(PLAN, "ana"), s.service.confirmHold(PLAN, "ana")]);
    expect(results.map((r) => r.ok && r.value.status)).toEqual(["placed", "placed"]);
    expect(s.plans.plan.members[0].holdPlaced).toBe(true);
  });

  it("refuses a hold for the wrong amount or the wrong person, recording nothing", async () => {
    const s = setup();
    const wrongAmount = await s.provider.createHold({ amountMinor: 100, currency: "USD", owner: { planId: PLAN, memberId: "ana" }, idempotencyKey: "cheat-1" });
    const wrongOwner = await s.provider.createHold({ amountMinor: 30_000, currency: "USD", owner: { planId: PLAN, memberId: "ben" }, idempotencyKey: "cheat-2" });
    if (!wrongAmount.ok || !wrongOwner.ok) throw new Error("holds should exist");

    for (const hold of [wrongAmount.value, wrongOwner.value]) {
      const fresh = setup();
      fresh.provider.completeCard(((await fresh.provider.createHold({ amountMinor: hold.amountMinor, currency: "USD", owner: hold.owner, idempotencyKey: "x" })) as { value: { id: string } }).value.id);
      await fresh.store.saveHoldId(PLAN, "ana", 0, "hold_1");
      expect(await fresh.service.confirmHold(PLAN, "ana")).toMatchObject({ ok: false, error: { kind: "mismatch" } });
      expect(fresh.plans.plan.members[0].holdPlaced).toBe(false);
    }
  });

  it("says the hold is gone when the plan ended or the hold was let go of, and records nothing", async () => {
    const released = setup();
    await released.form("ana");
    await released.service.releaseHolds(PLAN, ["ana"]);
    expect(await released.service.confirmHold(PLAN, "ana")).toMatchObject({ ok: false, error: { kind: "not_applicable" } });

    const ended = setup();
    await ended.form("ana");
    ended.placeCard("ana");
    await applyPlanEvent(ended.plans, PLAN, { type: "member_declined", at: NOW, memberId: "ben" });
    expect(await ended.service.confirmHold(PLAN, "ana")).toEqual({ ok: true, value: { status: "gone" } });
    expect(ended.plans.plan.members[0].holdPlaced).toBe(false);
  });

  it("reports the provider being down instead of guessing", async () => {
    const s = setup();
    await s.form("ana");
    s.provider.outages.add("getHold");
    expect(await s.service.confirmHold(PLAN, "ana")).toMatchObject({ ok: false, error: { kind: "payment" } });
    expect(s.plans.plan.members[0].holdPlaced).toBe(false);
  });

  it("has nothing to confirm for a person with no hold", async () => {
    expect(await setup().service.confirmHold(PLAN, "ana")).toMatchObject({ ok: false, error: { kind: "not_applicable" } });
  });
});

describe("releaseHolds", () => {
  it("lets go of each person's hold, forgets it, and skips people who have none", async () => {
    const s = setup();
    const ana = await s.form("ana");
    const result = await s.service.releaseHolds(PLAN, ["ana", "ben", "nobody"]);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(s.provider.all().find((h) => h.id === ana.holdId)?.status).toBe("released");
    expect(s.store.holdIdOf(PLAN, "ana")).toBeNull();
  });

  it("is harmless to run twice", async () => {
    const s = setup();
    await s.form("ana");
    await s.service.releaseHolds(PLAN, ["ana"]);
    s.provider.calls.length = 0;
    expect(await s.service.releaseHolds(PLAN, ["ana"])).toEqual({ ok: true, value: undefined });
    expect(s.provider.calls).toEqual([]);
  });

  it("lets go of a hold that already has a card on it, charging nothing", async () => {
    const s = setup();
    const { holdId } = await s.form("ana");
    s.placeCard("ana");
    await s.service.releaseHolds(PLAN, ["ana"]);
    expect(s.provider.all().find((h) => h.id === holdId)).toMatchObject({ status: "released", chargedMinor: 0, heldMinor: 0 });
  });

  it("keeps going when one release fails, reports it, and keeps that hold so it can be tried again", async () => {
    const s = setup();
    await s.form("ana");
    const benForm = await s.form("ben");
    s.provider.outages.add("release");
    expect(await s.service.releaseHolds(PLAN, ["ana", "ben"])).toMatchObject({ ok: false, error: { kind: "payment" } });
    expect(s.store.holdIdOf(PLAN, "ben")).toBe(benForm.holdId);

    s.provider.outages.delete("release");
    expect(await s.service.releaseHolds(PLAN, ["ana", "ben"])).toEqual({ ok: true, value: undefined });
    expect(s.provider.all().every((h) => h.status === "released")).toBe(true);
  });
});

describe("captureHolds", () => {
  /** A booked plan where both have placed their holds and Ana's price has since come down. */
  async function booked(): Promise<ReturnType<typeof setup> & { captures: readonly HoldCapture[] }> {
    const s = setup();
    for (const id of ["ana", "ben"]) {
      await s.form(id);
      s.placeCard(id);
      await s.service.confirmHold(PLAN, id);
    }
    await applyPlanEvent(s.plans, PLAN, { type: "price_rechecked", at: NOW, memberId: "ana", currentMinor: 25_000 });
    await applyPlanEvent(s.plans, PLAN, { type: "booking_started", at: NOW });
    const done = await applyPlanEvent(s.plans, PLAN, { type: "booking_succeeded", at: NOW });
    const effect = done.ok ? done.value.effects.find((e): e is Extract<PlanEffect, { type: "capture_holds" }> => e.type === "capture_holds") : undefined;
    if (!effect) throw new Error("booking should ask for the holds to be charged");
    return { ...s, captures: effect.captures };
  }

  it("charges each person today's share and lets go of the rest of their hold, then marks the plan paid", async () => {
    const s = await booked();
    expect(await s.service.captureHolds(PLAN, s.captures)).toEqual({ ok: true, value: undefined });
    expect(s.provider.all().map((h) => [h.owner.memberId, h.status, h.chargedMinor, h.heldMinor])).toEqual([["ana", "captured", 25_000, 0], ["ben", "captured", 30_000, 0]]);
    expect(s.plans.plan.status).toBe("captured");
    expect(s.plans.plan.members.map((m) => m.chargedMinor)).toEqual([25_000, 30_000]);
  });

  it("never charges more than a person approved, even when asked to, and charges nobody when any is refused", async () => {
    const s = await booked();
    const result = await s.service.captureHolds(PLAN, [{ memberId: "ana", captureMinor: 25_000, releaseMinor: 5_000 }, { memberId: "ben", captureMinor: 30_001, releaseMinor: 0 }]);
    expect(result).toMatchObject({ ok: false, error: { kind: "payment" } });
    expect(s.provider.all().find((h) => h.owner.memberId === "ben")).toMatchObject({ status: "held", chargedMinor: 0 });
    expect(s.plans.plan.status).toBe("booked");
  });

  it("leaves the plan unmarked when a charge fails, and finishes the job on a second run without charging twice", async () => {
    const s = await booked();
    s.provider.outages.add("capture");
    expect(await s.service.captureHolds(PLAN, s.captures)).toMatchObject({ ok: false, error: { kind: "payment" } });
    expect(s.plans.plan.status).toBe("booked");

    s.provider.outages.delete("capture");
    expect(await s.service.captureHolds(PLAN, s.captures)).toEqual({ ok: true, value: undefined });
    expect(await s.service.captureHolds(PLAN, s.captures)).toEqual({ ok: true, value: undefined });
    expect(s.provider.all().map((h) => h.chargedMinor)).toEqual([25_000, 30_000]);
    expect(s.plans.plan.status).toBe("captured");
  });

  it("refuses to charge a person who has no hold", async () => {
    const s = await booked();
    const result = await s.service.captureHolds(PLAN, [...s.captures, { memberId: "jia", captureMinor: 100, releaseMinor: 0 }]);
    expect(result).toMatchObject({ ok: false, error: { kind: "payment" } });
  });
});
