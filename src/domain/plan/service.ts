import { err, ok, type Result } from "@/lib/result";
import { applyPlanEvent } from "./apply-event";
import { computeApprovalExpiry } from "./deadline";
import type { EffectRunner } from "./effects";
import { isMaterialRise } from "./material-rise";
import { currentShares } from "./pricing";
import { refreshPlan, type RefreshDeps, type RefreshError, type RefreshOutcome } from "./refresh";
import { EXPIRABLE_PLAN_STATUSES } from "./statuses";
import type { PlanEffect, PlanEvent, PlanSnapshot } from "./types";

export interface PlanServiceDeps extends RefreshDeps {
  readonly effects: EffectRunner;
}

/**
 * "prices_stale": the offers could not be renewed in time. Try again in a moment.
 * "unknown_member" / "invalid_amount": the caller named someone who is not in the plan, or a price that is not money.
 */
export type ServiceError = RefreshError | { readonly kind: "prices_stale" | "unknown_member" | "invalid_amount"; readonly message: string };

/** `effectsFailed`: the plan changed but an effect could not be run. */
interface Dispatched {
  readonly effectsFailed: boolean;
}

export type RefreshResult = RefreshOutcome & Dispatched;

export type ActionOutcome =
  /** The event was applied. */
  | ({ readonly status: "done"; readonly plan: PlanSnapshot; readonly effects: readonly PlanEffect[] } & Dispatched)
  /** Nothing was recorded: today's price is higher than the one the member saw. Show them the new price first. */
  | { readonly status: "price_changed"; readonly currentMinor: number }
  /** The plan ended while checking: a chosen listing is gone, or the time ran out. Nothing was recorded. */
  | ({ readonly status: "plan_ended"; readonly plan: PlanSnapshot; readonly reason: "listing_unavailable" | "deadline_passed" } & Dispatched);

export interface OverdueSummary {
  readonly checked: number;
  /** Past the hard cap, so the plan ended whatever the offers say. */
  readonly expired: number;
  /** Past the deadline but inside the cap: the offers were checked again and are still on sale. */
  readonly renewed: number;
  /** Checked again and a listing was gone, so the plan ended. */
  readonly ended: number;
  /** Left for the next run: checked a moment ago, no longer open, or the offers could not be looked up. */
  readonly left: number;
}

type PlanEnded = Extract<ActionOutcome, { status: "plan_ended" }>;
type Fresh = { readonly status: "ready"; readonly plan: PlanSnapshot; readonly currentMinor: number } | PlanEnded;

const isMoney = (minor: number): boolean => Number.isSafeInteger(minor) && minor > 0;

/**
 * What members and the clock can do to a plan. Every action first looks at the offers again, so nobody agrees to
 * or pays for a price that has gone stale. Who the caller is must already be checked: this trusts `memberId`.
 */
export class PlanService {
  constructor(private readonly deps: PlanServiceDeps) {}

  /** Checks the offers again (at most once per cooldown) and runs whatever that set in motion. */
  async refresh(planId: string, now: Date): Promise<Result<RefreshResult, ServiceError>> {
    const refreshed = await refreshPlan(this.deps, planId, now);
    if (!refreshed.ok) return refreshed;
    if (refreshed.value.status === "skipped") return ok({ ...refreshed.value, effectsFailed: false });
    return ok({ ...refreshed.value, effectsFailed: await this.dispatch(planId, refreshed.value.version, refreshed.value.effects) });
  }

  /**
   * Step 1: the member agrees to the plan. `seenShareMinor` is the price they were shown. If today's price has
   * risen by more than the 5% rule allows since then, nothing is recorded. Otherwise they are held to the lower
   * of the two prices, so a rise is always measured from what they actually saw or from what it costs now.
   */
  async agree(planId: string, memberId: string, seenShareMinor: number, now: Date): Promise<Result<ActionOutcome, ServiceError>> {
    if (!isMoney(seenShareMinor)) return err({ kind: "invalid_amount", message: "The price the member saw must be a positive whole number of minor units" });
    const fresh = await this.freshShare(planId, memberId, now);
    if (!fresh.ok) return fresh;
    if (fresh.value.status === "plan_ended") return ok(fresh.value);

    const { currentMinor } = fresh.value;
    if (isMaterialRise(seenShareMinor, currentMinor)) return ok({ status: "price_changed", currentMinor });
    return this.apply(planId, { type: "plan_agreed", at: now, memberId, shareMinor: Math.min(seenShareMinor, currentMinor) });
  }

  /** Step 1: the member says no, which ends the plan. */
  decline(planId: string, memberId: string, now: Date): Promise<Result<ActionOutcome, ServiceError>> {
    return this.apply(planId, { type: "plan_declined", at: now, memberId });
  }

  /**
   * Step 2: the member approves paying. The amount (their cap, and the card hold) is today's price, decided here
   * and never taken from the caller. `seenShareMinor` only proves they saw a price at least as high.
   */
  async approveAmount(planId: string, memberId: string, seenShareMinor: number, now: Date): Promise<Result<ActionOutcome, ServiceError>> {
    if (!isMoney(seenShareMinor)) return err({ kind: "invalid_amount", message: "The price the member saw must be a positive whole number of minor units" });
    const fresh = await this.freshShare(planId, memberId, now);
    if (!fresh.ok) return fresh;
    if (fresh.value.status === "plan_ended") return ok(fresh.value);

    const { plan, currentMinor } = fresh.value;
    if (currentMinor > seenShareMinor) return ok({ status: "price_changed", currentMinor });
    const expiry = computeApprovalExpiry({ approvedAt: now, deadlineAt: plan.deadlineAt });
    if (!expiry.ok) return err({ kind: "prices_stale", message: expiry.error.message });
    return this.apply(planId, { type: "member_approved", at: now, memberId, amountMinor: currentMinor, expiresAt: expiry.value });
  }

  /** Step 2: the member says no, which ends the plan and gives every hold back. */
  declineAmount(planId: string, memberId: string, now: Date): Promise<Result<ActionOutcome, ServiceError>> {
    return this.apply(planId, { type: "member_declined", at: now, memberId });
  }

  /**
   * The clock's job. Plans past their hard cap end. Plans past only their deadline get their offers checked again,
   * which either renews them or ends them. One plan failing does not stop the others.
   */
  async expireOverdue(now: Date, limit: number): Promise<Result<OverdueSummary, ServiceError>> {
    const listed = await this.deps.details.listPastDeadline(now, limit);
    if (!listed.ok) return err({ kind: "repository", error: listed.error });

    const counts = { expired: 0, renewed: 0, ended: 0, left: 0 };
    for (const planId of listed.value) {
      const loaded = await this.deps.plans.load(planId);
      if (!loaded.ok) {
        counts.left += 1;
        continue;
      }
      if (now >= loaded.value.plan.hardDeadlineAt) {
        const expired = await this.apply(planId, { type: "deadline_passed", at: now });
        if (expired.ok) counts.expired += 1;
        else counts.left += 1;
        continue;
      }
      const refreshed = await this.refresh(planId, now);
      if (!refreshed.ok || refreshed.value.status === "skipped") counts.left += 1;
      else if (refreshed.value.status === "unavailable") counts.ended += 1;
      else counts.renewed += 1;
    }
    return ok({ checked: listed.value.length, ...counts });
  }

  /** The offers made current, and what this member owes for them. A plan whose time has run out ends here. */
  private async freshShare(planId: string, memberId: string, now: Date): Promise<Result<Fresh, ServiceError>> {
    const refreshed = await this.refresh(planId, now);
    if (!refreshed.ok) return refreshed;
    if (refreshed.value.status === "unavailable") {
      return ok({ status: "plan_ended", plan: refreshed.value.plan, reason: "listing_unavailable", effectsFailed: refreshed.value.effectsFailed });
    }

    const loaded = await this.deps.plans.load(planId);
    if (!loaded.ok) return err({ kind: "repository", error: loaded.error });
    const { plan } = loaded.value;

    if (EXPIRABLE_PLAN_STATUSES.includes(plan.status) && now >= plan.deadlineAt) {
      // Offers that could not be renewed in time must not be agreed to. Past the cap nothing can renew them.
      if (now < plan.hardDeadlineAt) return err({ kind: "prices_stale", message: "The prices could not be checked in time. Try again in a moment" });
      const ended = await this.apply(planId, { type: "deadline_passed", at: now });
      if (!ended.ok) return ended;
      if (ended.value.status !== "done") return err({ kind: "prices_stale", message: "The plan could not be ended" });
      return ok({ status: "plan_ended", plan: ended.value.plan, reason: "deadline_passed", effectsFailed: ended.value.effectsFailed });
    }

    const stored = await this.deps.details.load(planId);
    if (!stored.ok) return err({ kind: "repository", error: stored.error });
    const shares = currentShares(stored.value, stored.value.picks);
    if (!shares.ok) return err({ kind: "pricing_failed", message: shares.error.message });
    const share = shares.value.find((candidate) => candidate.memberId === memberId);
    if (!share) return err({ kind: "unknown_member", message: `No member ${memberId} in this plan` });
    return ok({ status: "ready", plan, currentMinor: share.shareMinor });
  }

  private async apply(planId: string, event: PlanEvent): Promise<Result<ActionOutcome, ServiceError>> {
    const applied = await applyPlanEvent(this.deps.plans, planId, event);
    if (!applied.ok) return err(applied.error);
    const effectsFailed = await this.dispatch(planId, applied.value.version, applied.value.effects);
    return ok({ status: "done", plan: applied.value.plan, effects: applied.value.effects, effectsFailed });
  }

  /** Returns whether the effects failed. */
  private async dispatch(planId: string, version: number, effects: readonly PlanEffect[]): Promise<boolean> {
    if (effects.length === 0) return false;
    const ran = await this.deps.effects.run(planId, version, effects);
    return !ran.ok;
  }
}
