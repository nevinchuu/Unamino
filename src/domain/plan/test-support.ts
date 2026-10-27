import { err, ok, type Result } from "@/lib/result";
import type { OfferQuery, OfferSource, OfferSourceError } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import type { PlanDetails, PlanDetailsStore, RenewedPick } from "./details-store";
import type { PlanRepository, RepositoryError, StoredPlan } from "./repository";
import type { MemberSnapshot, PlanSnapshot } from "./types";

/** A plan store in memory that enforces the same version rule as the real one. */
export class MemoryPlanRepository implements PlanRepository {
  saves = 0;
  constructor(public stored: StoredPlan) {}

  async load(): Promise<Result<StoredPlan, RepositoryError>> {
    return ok(this.stored);
  }

  async save(stored: StoredPlan, next: PlanSnapshot): Promise<Result<StoredPlan, RepositoryError>> {
    if (this.stored.version !== stored.version) return err({ code: "version_conflict", message: "changed" });
    this.saves += 1;
    this.stored = { id: stored.id, version: stored.version + 1, plan: next };
    return ok(this.stored);
  }

  get plan(): PlanSnapshot {
    return this.stored.plan;
  }
}

/** The details of a plan in memory, with the same cooldown rule as the real store. */
export class MemoryDetailsStore implements PlanDetailsStore {
  claims = 0;
  renewals: (readonly RenewedPick[])[] = [];
  constructor(public details: PlanDetails) {}

  async load(): Promise<Result<PlanDetails, RepositoryError>> {
    return ok(this.details);
  }

  async claimRefresh(_planId: string, now: Date, cooldownMs: number): Promise<Result<boolean, RepositoryError>> {
    const last = this.details.offersCheckedAt;
    if (last && last.getTime() > now.getTime() - cooldownMs) return ok(false);
    this.claims += 1;
    this.details = { ...this.details, offersCheckedAt: now };
    return ok(true);
  }

  async saveRenewal(_planId: string, renewed: readonly RenewedPick[]): Promise<Result<void, RepositoryError>> {
    this.renewals.push(renewed);
    const offerByPick = new Map(renewed.map((pick) => [pick.pickId, pick.offer]));
    this.details = { ...this.details, picks: this.details.picks.map((pick) => ({ ...pick, offer: offerByPick.get(pick.id) ?? pick.offer })) };
    return ok(undefined);
  }

  async listPastDeadline(): Promise<Result<readonly string[], RepositoryError>> {
    return ok([]);
  }
}

/** An offer source that answers each query from a function and remembers what it was asked. */
export class ScriptedSource implements OfferSource {
  readonly queries: OfferQuery[] = [];
  constructor(private readonly answer: (query: OfferQuery) => Result<readonly Offer[], OfferSourceError>) {}

  async search(query: OfferQuery): Promise<Result<readonly Offer[], OfferSourceError>> {
    this.queries.push(query);
    return this.answer(query);
  }
}

export const memberSnapshot = (id: string, overrides: Partial<MemberSnapshot> = {}): MemberSnapshot => ({
  id,
  planAgreement: "pending",
  agreedShareMinor: null,
  approval: "pending",
  approvedMinor: null,
  currentShareMinor: null,
  chargedMinor: null,
  approvalExpiresAt: null,
  holdPlaced: false,
  ...overrides,
});
