import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HoldService } from "@/domain/payments/hold-service";
import { PaymentEffectRunner } from "@/domain/payments/payment-effects";
import { applyPlanEvent } from "@/domain/plan/apply-event";
import { CompositeEffectRunner, type EffectRunner } from "@/domain/plan/effects";
import type { PlanEffect } from "@/domain/plan/types";
import { connectDatabase, type DatabaseHandle } from "./db/client";
import { PostgresEffectLog } from "./db/postgres-effect-log";
import { PostgresEffectRecorder } from "./db/postgres-effect-recorder";
import { PostgresHoldStore } from "./db/postgres-hold-store";
import { PostgresPlanRepository } from "./db/postgres-plan-repository";
import { effectLog, groups, members, planMembers, plans, tripBriefs } from "./db/schema";
import { createStripeClient } from "./stripe/stripe-client";
import { StripePaymentProvider } from "./stripe/stripe-provider";

/**
 * The whole money lifecycle on the real database and Stripe's real TEST mode, with Stripe's published test card:
 * holds are made for what people approved, confirmed with Stripe before the plan records them, then either charged
 * in part (with the rest let go) or released. No browser is involved. It makes test-mode holds only; no money moves.
 *   STRIPE_LIVE=1 DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run payments.live
 */
const LIVE = process.env.STRIPE_LIVE === "1" && process.env.DB_TESTS === "1";
const KEY = process.env.STRIPE_SECRET_KEY ?? "";

describe.skipIf(!LIVE)("holds on the real database and Stripe's test mode", () => {
  const T0 = new Date();
  let handle: DatabaseHandle;
  let groupId: string;
  let briefId: string;
  let service: HoldService;
  let plansRepo: PostgresPlanRepository;
  let effects: EffectRunner;
  const stripe = createStripeClient(KEY.startsWith("sk_test_") ? KEY : "sk_test_refused");
  const memberIds: Record<string, string> = {};

  /** A plan in step 2 where both people have approved: Ana up to 300.00 and Ben up to 200.00, with nothing held yet. */
  async function seedPlan(): Promise<string> {
    const [plan] = await handle.db
      .insert(plans)
      .values({ groupId, briefId, status: "approving", title: "Live test", deadlineAt: new Date(T0.getTime() + 3_600_000), hardDeadlineAt: new Date(T0.getTime() + 7_200_000), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 2, inputsHash: "live" })
      .returning({ id: plans.id });
    const expires = new Date(T0.getTime() + 3_600_000);
    await handle.db.insert(planMembers).values([
      { planId: plan.id, memberId: memberIds.ana, planAgreement: "agreed", agreedShareMinor: 30_000, approval: "approved", approvedMinor: 30_000, currentShareMinor: 30_000, approvalExpiresAt: expires },
      { planId: plan.id, memberId: memberIds.ben, planAgreement: "agreed", agreedShareMinor: 20_000, approval: "approved", approvedMinor: 20_000, currentShareMinor: 20_000, approvalExpiresAt: expires },
    ]);
    return plan.id;
  }

  /** What the browser does: the card form confirms Stripe's test card on the person's hold. */
  const enterCard = async (holdId: string) => {
    await stripe.paymentIntents.confirm(holdId, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
  };

  const statusOf = async (planId: string): Promise<string> => {
    const stored = await plansRepo.load(planId);
    if (!stored.ok) throw new Error(`no plan: ${stored.error.message}`);
    return stored.value.plan.status;
  };

  const holdOf = async (planId: string, who: "ana" | "ben") => {
    const form = await service.ensureHold(planId, memberIds[who]);
    if (!form.ok) throw new Error(`no hold for ${who}: ${form.error.message}`);
    return form.value;
  };

  beforeAll(async () => {
    if (!KEY.startsWith("sk_test_")) throw new Error("Refusing to run: STRIPE_SECRET_KEY is not a test key");
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 8);

    const [group] = await handle.db.insert(groups).values({ name: "live-payments-test", baseCurrency: "USD" }).returning({ id: groups.id });
    groupId = group.id;
    for (const name of ["ana", "ben"] as const) {
      const [row] = await handle.db.insert(members).values({ groupId, displayName: name, currency: "USD", status: "joined", joinedAt: T0, inviteTokenHash: randomUUID() }).returning({ id: members.id });
      memberIds[name] = row.id;
    }
    const [brief] = await handle.db.insert(tripBriefs).values({ groupId, version: 1, headcount: 2 }).returning({ id: tripBriefs.id });
    briefId = brief.id;

    plansRepo = new PostgresPlanRepository(handle.db);
    const log = new PostgresEffectLog(handle.db);
    service = new HoldService({ provider: new StripePaymentProvider(stripe), store: new PostgresHoldStore(handle.db), plans: plansRepo, effects: () => effects, clock: () => new Date() });
    effects = new CompositeEffectRunner([new PostgresEffectRecorder(handle.db), new PaymentEffectRunner(service, log)]);
  }, 60_000);

  afterAll(async () => {
    if (!handle) return;
    await handle.db.delete(plans).where(eq(plans.groupId, groupId));
    await handle.db.delete(groups).where(eq(groups.id, groupId));
    await handle.close();
  }, 60_000);

  it("holds what each person approved, records a hold only after Stripe confirms it, charges today's share, and lets go of the rest", async () => {
    const planId = await seedPlan();

    // Each person's hold is for exactly what they approved, and nothing is set aside until their card is confirmed.
    const [ana, ben] = [await holdOf(planId, "ana"), await holdOf(planId, "ben")];
    expect([ana.amountMinor, ben.amountMinor]).toEqual([30_000, 20_000]);
    expect(ana.clientSecret).toEqual(expect.stringContaining("_secret_"));
    expect(await service.confirmHold(planId, memberIds.ana)).toEqual({ ok: true, value: { status: "waiting", reason: null } });
    expect((await stripe.paymentIntents.retrieve(ana.holdId)).metadata).toEqual({ planId, memberId: memberIds.ana });

    // Asking again gives the same hold, not a second one.
    expect((await holdOf(planId, "ana")).holdId).toBe(ana.holdId);

    // Cards are confirmed in the browser; the plan hears about it by being asked to confirm, and checks with Stripe.
    await enterCard(ana.holdId);
    expect(await service.confirmHold(planId, memberIds.ana)).toEqual({ ok: true, value: { status: "placed" } });
    await enterCard(ben.holdId);
    expect(await service.confirmHold(planId, memberIds.ben)).toEqual({ ok: true, value: { status: "placed" } });
    expect(await statusOf(planId)).toBe("held");

    // Ana's share comes down, the trip is booked, and each person is charged what they owe.
    await applyPlanEvent(plansRepo, planId, { type: "price_rechecked", at: new Date(), memberId: memberIds.ana, currentMinor: 24_000 });
    await applyPlanEvent(plansRepo, planId, { type: "booking_started", at: new Date() });
    const booked = await applyPlanEvent(plansRepo, planId, { type: "booking_succeeded", at: new Date() });
    if (!booked.ok) throw new Error(`booking: ${JSON.stringify(booked.error)}`);
    expect(booked.value.effects.map((e: PlanEffect) => e.type)).toEqual(["capture_holds"]);
    expect(await effects.run(planId, booked.value.version, booked.value.effects)).toEqual({ ok: true, value: undefined });

    // What Stripe says: Ana charged 240.00 of her 300.00 hold, Ben 200.00, and nothing left held.
    const [anaPi, benPi] = [await stripe.paymentIntents.retrieve(ana.holdId), await stripe.paymentIntents.retrieve(ben.holdId)];
    expect([anaPi.status, anaPi.amount_received, anaPi.amount_capturable]).toEqual(["succeeded", 24_000, 0]);
    expect([benPi.status, benPi.amount_received, benPi.amount_capturable]).toEqual(["succeeded", 20_000, 0]);

    // What the plan says: paid, with each person's charge recorded and never above what they approved.
    expect(await statusOf(planId)).toBe("captured");
    const rows = await handle.db.select().from(planMembers).where(eq(planMembers.planId, planId));
    expect(rows.map((r) => [r.chargedMinor, r.approvedMinor]).sort()).toEqual([[20_000, 20_000], [24_000, 30_000]]);

    // Every money effect was written down as done.
    const logged = await handle.db.select().from(effectLog).where(eq(effectLog.planId, planId));
    expect(logged.filter((row) => row.type === "capture_holds").map((row) => row.status)).toEqual(["done"]);
  }, 120_000);

  it("lets go of every hold, charging nothing, when the plan ends, including one that never got a card", async () => {
    const planId = await seedPlan();
    const [ana, ben] = [await holdOf(planId, "ana"), await holdOf(planId, "ben")];
    await enterCard(ana.holdId);
    await service.confirmHold(planId, memberIds.ana);
    // Ben approved but never added his card, and then he backs out.
    const ended = await applyPlanEvent(plansRepo, planId, { type: "member_declined", at: new Date(), memberId: memberIds.ben });
    if (!ended.ok) throw new Error(`decline: ${JSON.stringify(ended.error)}`);
    expect(ended.value.effects).toEqual([{ type: "release_holds", memberIds: [memberIds.ana, memberIds.ben] }]);
    expect(await effects.run(planId, ended.value.version, ended.value.effects)).toEqual({ ok: true, value: undefined });

    const [anaPi, benPi] = [await stripe.paymentIntents.retrieve(ana.holdId), await stripe.paymentIntents.retrieve(ben.holdId)];
    expect([anaPi.status, anaPi.amount_received]).toEqual(["canceled", 0]);
    expect([benPi.status, benPi.amount_received]).toEqual(["canceled", 0]);
    const rows = await handle.db.select().from(planMembers).where(eq(planMembers.planId, planId));
    expect(rows.every((row) => row.holdId === null && row.holdAttempt === 1)).toBe(true);
  }, 120_000);

  it("makes a new hold for a new approval after a release, and refuses a hold for a different amount than was approved", async () => {
    const planId = await seedPlan();
    const first = await holdOf(planId, "ana");
    await service.releaseHolds(planId, [memberIds.ana]);
    const second = await holdOf(planId, "ana");
    expect(second.holdId).not.toBe(first.holdId);
    expect((await stripe.paymentIntents.retrieve(first.holdId)).status).toBe("canceled");

    // A hold made behind the app's back for a smaller amount is never recorded, even with a good card on it.
    await service.releaseHolds(planId, [memberIds.ana]);
    const cheat = await stripe.paymentIntents.create({ amount: 100, currency: "usd", capture_method: "manual", metadata: { planId, memberId: memberIds.ana, purpose: "unamino-smoke-test" }, automatic_payment_methods: { enabled: true, allow_redirects: "never" } });
    await new PostgresHoldStore(handle.db).saveHoldId(planId, memberIds.ana, 2, cheat.id);
    await enterCard(cheat.id);
    expect(await service.confirmHold(planId, memberIds.ana)).toMatchObject({ ok: false, error: { kind: "mismatch" } });
    const rows = await handle.db.select().from(planMembers).where(eq(planMembers.planId, planId));
    expect(rows.find((row) => row.memberId === memberIds.ana)?.holdPlaced).toBe(false);
    await stripe.paymentIntents.cancel(cheat.id);
  }, 120_000);
});
