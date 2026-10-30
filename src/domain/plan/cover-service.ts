import { err, ok, type Result } from "@/lib/result";
import { coverProblem } from "@/domain/split/covers";
import type { Cover } from "@/domain/split/types";
import { applyPlanEvent } from "./apply-event";
import type { CoverStore } from "./cover-store";
import type { PlanDetailsStore } from "./details-store";
import type { EffectRunner } from "./effects";
import { currentShares } from "./pricing";
import type { PlanRepository } from "./repository";

/** What a friend asks for: the whole of someone's part, a percent of it (follows the price), or a fixed amount (base currency, minor units). */
export type CoverRequest = { readonly kind: "all" } | { readonly kind: "percent"; readonly percent: number } | { readonly kind: "amount"; readonly amountBaseMinor: number };

function coverOf(sponsorId: string, beneficiaryId: string, request: CoverRequest): Cover {
  switch (request.kind) {
    case "all":
      return { sponsorId, beneficiaryId, amountBaseMinor: null };
    case "percent":
      return { sponsorId, beneficiaryId, amountBaseMinor: null, sharePercent: request.percent };
    case "amount":
      return { sponsorId, beneficiaryId, amountBaseMinor: request.amountBaseMinor };
  }
}

/**
 * "not_in_plan": one of the two is not in this plan.
 * "not_open": the plan has ended, or every hold is in and booking is under way, so who pays what can no longer move.
 * "invalid": not allowed (covering yourself, a chain, an amount that is not money). `message` says why, in plain words.
 * "too_much": more than the person's own part. `ownPartBaseMinor` is the most that can be covered.
 * "unavailable": the database or the plan was busy. Nothing was changed.
 */
export type CoverError =
  | { readonly kind: "not_in_plan" | "not_open" | "invalid" | "unavailable"; readonly message: string }
  | { readonly kind: "too_much"; readonly message: string; readonly ownPartBaseMinor: number };

export type CoverOutcome =
  /** The cover was made or removed and everyone is back at step 1. `effectsFailed`: letting go of the holds did not all go through. */
  | { readonly status: "changed"; readonly effectsFailed: boolean }
  /** Already exactly like that. Nothing moved, so nobody has to look again. */
  | { readonly status: "unchanged" };

export interface CoverServiceDeps {
  readonly plans: PlanRepository;
  readonly details: PlanDetailsStore;
  readonly covers: CoverStore;
  readonly effects: EffectRunner;
  readonly clock: () => Date;
}

const unavailable = (): CoverError => ({ kind: "unavailable", message: "The plan could not be changed just now" });

/**
 * A friend paying some or all of someone else's part. The trip total stays the same; only whose card pays what moves.
 * Because the amounts change, everyone goes back to agree and approve again, the same as when the picks change. Who the
 * caller is must already be checked: this trusts `sponsorId`.
 */
export class CoverService {
  constructor(private readonly deps: CoverServiceDeps) {}

  async set(planId: string, sponsorId: string, beneficiaryId: string, request: CoverRequest): Promise<Result<CoverOutcome, CoverError>> {
    const context = await this.context(planId);
    if (!context.ok) return context;
    const { memberIds, existing, ownPartBaseMinor } = context.value;

    const cover = coverOf(sponsorId, beneficiaryId, request);
    const others = existing.filter((entry) => !(entry.sponsorId === sponsorId && entry.beneficiaryId === beneficiaryId));
    const problem = coverProblem([...others, cover], memberIds);
    if (problem) return err({ kind: memberIds.includes(sponsorId) && memberIds.includes(beneficiaryId) ? "invalid" : "not_in_plan", message: problem });

    const ownPart = ownPartBaseMinor.get(beneficiaryId) ?? 0;
    if (cover.amountBaseMinor !== null && cover.amountBaseMinor > ownPart) {
      return err({ kind: "too_much", message: "That is more than their share", ownPartBaseMinor: ownPart });
    }

    const previous = existing.find((entry) => entry.sponsorId === sponsorId && entry.beneficiaryId === beneficiaryId);
    if (previous && previous.amountBaseMinor === cover.amountBaseMinor && (previous.sharePercent ?? null) === (cover.sharePercent ?? null)) return ok({ status: "unchanged" });

    const saved = await this.deps.covers.save(planId, cover);
    if (!saved.ok) return err(unavailable());
    return this.reset(planId, () => (previous ? this.deps.covers.save(planId, previous) : this.deps.covers.remove(planId, sponsorId, beneficiaryId)));
  }

  /** Takes the cover back. Someone who was never covering them is a quiet no-op. */
  async remove(planId: string, sponsorId: string, beneficiaryId: string): Promise<Result<CoverOutcome, CoverError>> {
    const context = await this.context(planId);
    if (!context.ok) return context;
    const previous = context.value.existing.find((entry) => entry.sponsorId === sponsorId && entry.beneficiaryId === beneficiaryId);
    if (!previous) return ok({ status: "unchanged" });

    const removed = await this.deps.covers.remove(planId, sponsorId, beneficiaryId);
    if (!removed.ok) return err(unavailable());
    return this.reset(planId, () => this.deps.covers.save(planId, previous));
  }

  /** Sends everyone back to step 1. If the plan refuses, `undo` puts the covers back as they were so nothing is half done. */
  private async reset(planId: string, undo: () => Promise<Result<void, unknown>>): Promise<Result<CoverOutcome, CoverError>> {
    const applied = await applyPlanEvent(this.deps.plans, planId, { type: "covers_changed", at: this.deps.clock() });
    if (!applied.ok) {
      await undo();
      if (applied.error.kind === "transition") return err({ kind: "not_open", message: "The plan has moved on, so who pays what can no longer change" });
      return err(unavailable());
    }
    const ran = applied.value.effects.length === 0 ? ok(undefined) : await this.deps.effects.run(planId, applied.value.version, applied.value.effects);
    return ok({ status: "changed", effectsFailed: !ran.ok });
  }

  private async context(planId: string) {
    const stored = await this.deps.plans.load(planId);
    if (!stored.ok) return err(stored.error.code === "not_found" ? ({ kind: "not_in_plan", message: "There is no such plan" } as const) : unavailable());
    if (stored.value.plan.status !== "reviewing" && stored.value.plan.status !== "approving") {
      return err({ kind: "not_open", message: "The plan has moved on, so who pays what can no longer change" } as const);
    }
    const details = await this.deps.details.load(planId);
    if (!details.ok) return err(unavailable());

    // Priced without covers: what each person takes part in is the most that can be covered for them.
    const shares = currentShares({ ...details.value, covers: [] }, details.value.picks);
    if (!shares.ok) return err(unavailable());
    return ok({
      memberIds: details.value.members.map((member) => member.id),
      existing: details.value.covers,
      ownPartBaseMinor: new Map(shares.value.map((share) => [share.memberId, share.baseShareMinor])),
    });
  }
}
