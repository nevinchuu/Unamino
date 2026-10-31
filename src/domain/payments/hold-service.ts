import { err, ok, type Result } from "@/lib/result";
import { applyPlanEvent } from "@/domain/plan/apply-event";
import type { EffectRunner } from "@/domain/plan/effects";
import type { PlanRepository } from "@/domain/plan/repository";
import type { HoldCapture } from "@/domain/plan/types";
import type { HoldRecord, HoldStore, HoldStoreError } from "./hold-store";
import type { Hold, PaymentError, PaymentProvider } from "./types";
import { checkHold } from "./verify";

/**
 * "not_applicable": no hold is needed right now (the plan is not at step 2, or the person has not approved).
 * "payment": the payment provider failed or refused.
 * "store": the database failed.
 * "mismatch": what the provider says does not match what the plan expects. Nothing is recorded.
 * "plan": the plan refused the change.
 */
export interface HoldFailure {
  readonly kind: "not_applicable" | "payment" | "store" | "mismatch" | "plan";
  /** For logs. It can name internals, so it is never shown to people. */
  readonly message: string;
}

/** What the browser needs to show the card form for a person's hold. */
export interface CardForm {
  readonly holdId: string;
  readonly clientSecret: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** "held" means a card is already on it and only confirming is left. */
  readonly status: "awaiting_card" | "held";
}

export type ConfirmOutcome =
  | { readonly status: "placed" }
  /** The card has not been confirmed (yet). `reason` is why the last attempt failed, if it did. */
  | { readonly status: "waiting"; readonly reason: string | null }
  /** The plan moved on or the hold was let go of, so there is nothing to place. */
  | { readonly status: "gone" };

export interface HoldServiceDeps {
  readonly provider: PaymentProvider;
  readonly store: HoldStore;
  readonly plans: PlanRepository;
  /** Where the effects of "the last hold was placed" go. A function, because the effects include this service's own work. */
  readonly effects: () => EffectRunner;
  readonly clock: () => Date;
}

/** One person's charge, checked and ready: `chargedMinor` is set when it was already made. */
interface ChargeToMake {
  readonly memberId: string;
  readonly holdId: string;
  readonly captureMinor: number;
  readonly chargedMinor: number | null;
}

const fromStore = (error: HoldStoreError): HoldFailure => ({ kind: "store", message: error.message });
const fromPayment = (error: PaymentError): HoldFailure => ({ kind: "payment", message: error.message });
const notApplicable = (message: string): HoldFailure => ({ kind: "not_applicable", message });

/** A hold that can still be used for what the person approved. */
function usable(hold: Hold, record: HoldRecord, cap: number): boolean {
  return (
    (hold.status === "awaiting_card" || hold.status === "held") &&
    hold.amountMinor === cap &&
    hold.currency.toUpperCase() === record.currency.toUpperCase() &&
    hold.owner.planId === record.planId &&
    hold.owner.memberId === record.memberId
  );
}

/**
 * Everything about a person's card hold between "I approve" and "charged or let go". A hold is made for exactly what
 * the person approved, the plan only records it once the payment provider confirms it, and nothing is charged
 * above what was approved. Every call can be repeated: it ends up in the same place.
 */
export class HoldService {
  constructor(private readonly deps: HoldServiceDeps) {}

  /** Makes the hold for what the person approved (or finds the one they have) and says what the card form needs. */
  async ensureHold(planId: string, memberId: string): Promise<Result<CardForm, HoldFailure>> {
    const found = await this.deps.store.find(planId, memberId);
    if (!found.ok) return err(fromStore(found.error));
    const record = found.value;
    const cap = record.approvedMinor;
    if (record.planStatus !== "approving" || record.approval !== "approved" || record.holdPlaced || cap === null) {
      return err(notApplicable("A hold is only needed after approving, while the plan waits for everyone's holds"));
    }
    if (cap === 0) return err(notApplicable("A friend covers this person's whole share, so there is nothing to hold"));

    if (record.holdId) {
      const existing = await this.deps.provider.getHold(record.holdId);
      if (existing.ok && usable(existing.value, record, cap)) return this.formOf(existing.value);
      if (existing.ok && existing.value.status === "captured") return err({ kind: "mismatch", message: "That hold was already charged" });
      if (!existing.ok && existing.error.code !== "not_found") return err(fromPayment(existing.error));

      // Not usable for what was approved (it was let go of, or is for another amount): let it go and start a new one.
      if (existing.ok && existing.value.status !== "released") {
        const released = await this.deps.provider.release(record.holdId, `release:${record.holdId}`);
        if (!released.ok) return err(fromPayment(released.error));
      }
      const cleared = await this.deps.store.clearHold(planId, memberId, record.holdId);
      if (!cleared.ok) return err(fromStore(cleared.error));
      return this.create(planId, memberId);
    }
    return this.create(planId, memberId, record);
  }

  /** Records a hold only after the payment provider confirms it is set aside, in full, for this person and this plan. */
  async confirmHold(planId: string, memberId: string): Promise<Result<ConfirmOutcome, HoldFailure>> {
    const found = await this.deps.store.find(planId, memberId);
    if (!found.ok) return err(fromStore(found.error));
    const record = found.value;
    if (record.holdPlaced) return ok({ status: "placed" });
    if (record.planStatus !== "approving" || record.approval !== "approved" || record.approvedMinor === null) return ok({ status: "gone" });
    if (!record.holdId) return err(notApplicable("There is no hold to confirm"));

    const fetched = await this.deps.provider.getHold(record.holdId);
    if (!fetched.ok) return err(fromPayment(fetched.error));
    const hold = fetched.value;
    if (hold.status === "released" || hold.status === "captured") return ok({ status: "gone" });

    const checked = checkHold(hold, { owner: { planId, memberId }, amountMinor: record.approvedMinor, currency: record.currency });
    if (!checked.ok) {
      return checked.reason === "not_held" ? ok({ status: "waiting", reason: hold.lastError }) : err({ kind: "mismatch", message: `The hold does not match the plan: ${checked.reason}` });
    }

    const applied = await applyPlanEvent(this.deps.plans, planId, { type: "hold_placed", at: this.deps.clock(), memberId });
    if (!applied.ok) {
      if (applied.error.kind === "repository") return err({ kind: "store", message: applied.error.error.message });
      // Placed already (a second call, or the webhook got there first) is the same as placed; any other refusal means the plan moved on.
      return ok({ status: applied.error.error.code === "invalid_member_state" ? "placed" : "gone" });
    }
    // The effects of the last hold (booking) are not this call's to succeed or fail: the hold is placed either way.
    if (applied.value.effects.length > 0) await this.deps.effects().run(planId, applied.value.version, applied.value.effects);
    return ok({ status: "placed" });
  }

  /**
   * For someone whose whole share a friend covers: there is no card, so there is no hold to wait for. Once their
   * details are in (the caller checks) they count as ready, and the last person ready sets the booking going.
   */
  async confirmCovered(planId: string, memberId: string): Promise<Result<ConfirmOutcome, HoldFailure>> {
    const found = await this.deps.store.find(planId, memberId);
    if (!found.ok) return err(fromStore(found.error));
    const record = found.value;
    if (record.holdPlaced) return ok({ status: "placed" });
    if (record.planStatus !== "approving" || record.approval !== "approved") return ok({ status: "gone" });
    if (record.approvedMinor !== 0) return err(notApplicable("This person pays by card"));

    const applied = await applyPlanEvent(this.deps.plans, planId, { type: "hold_placed", at: this.deps.clock(), memberId });
    if (!applied.ok) {
      if (applied.error.kind === "repository") return err({ kind: "store", message: applied.error.error.message });
      return ok({ status: applied.error.error.code === "invalid_member_state" ? "placed" : "gone" });
    }
    if (applied.value.effects.length > 0) await this.deps.effects().run(planId, applied.value.version, applied.value.effects);
    return ok({ status: "placed" });
  }

  /** Lets go of these people's holds. Those with none are skipped, and one failing does not stop the others. */
  async releaseHolds(planId: string, memberIds: readonly string[]): Promise<Result<void, HoldFailure>> {
    const failures: string[] = [];
    for (const memberId of memberIds) {
      const found = await this.deps.store.find(planId, memberId);
      if (!found.ok) {
        if (found.error.code !== "not_found") failures.push(found.error.message);
        continue;
      }
      const { holdId } = found.value;
      if (!holdId) continue;

      const released = await this.deps.provider.release(holdId, `release:${holdId}`);
      // A hold the provider has never heard of is as good as let go of.
      if (!released.ok && released.error.code !== "not_found") {
        failures.push(released.error.message);
        continue;
      }
      const cleared = await this.deps.store.clearHold(planId, memberId, holdId);
      if (!cleared.ok) failures.push(cleared.error.message);
    }
    return failures.length === 0 ? ok(undefined) : err({ kind: "payment", message: failures.join("; ") });
  }

  /**
   * Charges each person today's share of their hold and lets go of the rest. Nobody is charged more than they approved,
   * whatever is asked of this. Every hold is checked first, so one that has gone bad is found before anyone is charged
   * and nobody is charged for a trip that cannot be paid for in full. Each charge is written on the plan as it lands, so
   * the screen shows who has been charged if a later one fails. Once every charge has gone through the plan is marked
   * paid; if any has not, nothing is marked and the whole thing can be run again, because charges already made are not
   * made twice.
   */
  async captureHolds(planId: string, captures: readonly HoldCapture[]): Promise<Result<void, HoldFailure>> {
    const ready = await this.checkBeforeCharging(planId, captures);
    if (!ready.ok) return err(ready.error);

    const failures: string[] = [];
    for (const { memberId, holdId, captureMinor, chargedMinor } of ready.value) {
      let charged = chargedMinor;
      if (charged === null) {
        const captured = await this.deps.provider.capture(holdId, captureMinor, `capture:${holdId}`);
        if (!captured.ok) {
          failures.push(captured.error.message);
          continue;
        }
        charged = captured.value.chargedMinor;
      }
      // Only for the screen: the plan fills in anything missing when it is marked paid, so a failure here is not a failed charge.
      await applyPlanEvent(this.deps.plans, planId, { type: "member_charged", at: this.deps.clock(), memberId, chargedMinor: charged });
    }
    if (failures.length > 0) return err({ kind: "payment", message: failures.join("; ") });

    const applied = await applyPlanEvent(this.deps.plans, planId, { type: "capture_succeeded", at: this.deps.clock() });
    if (applied.ok) return ok(undefined);
    if (applied.error.kind === "repository") return err({ kind: "store", message: applied.error.error.message });
    // Already marked paid, by an earlier run, is the same as done.
    return applied.error.error.code === "plan_closed" ? ok(undefined) : err({ kind: "plan", message: applied.error.error.message });
  }

  /**
   * Looks at every hold that is to be charged before any is. `chargedMinor` is set for one that was already charged
   * (by an earlier run), so it is not charged again. Any hold that cannot be charged stops all of them.
   */
  private async checkBeforeCharging(planId: string, captures: readonly HoldCapture[]): Promise<Result<readonly ChargeToMake[], HoldFailure>> {
    const ready: ChargeToMake[] = [];
    const problems: string[] = [];
    for (const capture of captures) {
      const found = await this.deps.store.find(planId, capture.memberId);
      if (!found.ok) {
        problems.push(found.error.message);
        continue;
      }
      const { holdId, approvedMinor, currency } = found.value;
      if (!holdId) {
        problems.push("A member has no hold to charge");
        continue;
      }
      if (approvedMinor === null || capture.captureMinor > approvedMinor) {
        problems.push("A charge is above what the person approved, so it was not made");
        continue;
      }
      const fetched = await this.deps.provider.getHold(holdId);
      if (!fetched.ok) {
        problems.push(fetched.error.message);
        continue;
      }
      const hold = fetched.value;
      if (hold.status === "captured" && hold.owner.planId === planId && hold.owner.memberId === capture.memberId) {
        ready.push({ memberId: capture.memberId, holdId, captureMinor: capture.captureMinor, chargedMinor: hold.chargedMinor });
        continue;
      }
      const checked = checkHold(hold, { owner: { planId, memberId: capture.memberId }, amountMinor: approvedMinor, currency });
      if (!checked.ok) {
        problems.push(`A member's hold cannot be charged (${checked.reason})`);
        continue;
      }
      ready.push({ memberId: capture.memberId, holdId, captureMinor: capture.captureMinor, chargedMinor: null });
    }
    return problems.length === 0 ? ok(ready) : err({ kind: "payment", message: `Nobody more was charged: ${problems.join("; ")}` });
  }

  private async create(planId: string, memberId: string, known?: HoldRecord): Promise<Result<CardForm, HoldFailure>> {
    const found = known ? ok(known) : await this.deps.store.find(planId, memberId);
    if (!found.ok) return err(fromStore(found.error));
    const record = found.value;
    if (record.approvedMinor === null) return err(notApplicable("The person has not approved an amount"));

    const created = await this.deps.provider.createHold({
      amountMinor: record.approvedMinor,
      currency: record.currency,
      owner: { planId, memberId },
      // The attempt makes the same request give the same hold, and a new approval after a release give a new one.
      idempotencyKey: `hold:${planId}:${memberId}:${record.holdAttempt}`,
    });
    if (!created.ok) return err(fromPayment(created.error));

    const saved = await this.deps.store.saveHoldId(planId, memberId, record.holdAttempt, created.value.id);
    if (!saved.ok) return err(fromStore(saved.error));
    if (saved.value === created.value.id) return this.formOf(created.value);

    // Another call saved its hold first; use that one.
    const current = await this.deps.provider.getHold(saved.value);
    return current.ok ? this.formOf(current.value) : err(fromPayment(current.error));
  }

  private formOf(hold: Hold): Result<CardForm, HoldFailure> {
    if (!hold.clientSecret || (hold.status !== "awaiting_card" && hold.status !== "held")) return err({ kind: "payment", message: "The hold has no card form to show" });
    return ok({ holdId: hold.id, clientSecret: hold.clientSecret, amountMinor: hold.amountMinor, currency: hold.currency, status: hold.status });
  }
}
