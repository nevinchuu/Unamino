import type { Result } from "@/lib/result";
import type { OfferQuery } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import type { FxRateTable } from "@/domain/split/types";
import type { RepositoryError } from "./repository";

/** One bought item of a plan, with the members it is for. */
export interface StoredPick {
  readonly id: string;
  readonly offer: Offer;
  /** The search that found it. Null if that search no longer exists, so the pick cannot be renewed. */
  readonly searchId: string | null;
  readonly memberIds: readonly string[];
}

/** What pricing a plan again needs, apart from the approval state that `PlanRepository` holds. */
export interface PlanDetails {
  readonly planId: string;
  readonly baseCurrency: string;
  readonly fx: FxRateTable;
  /** When the offers were last checked, or when a check was last started. */
  readonly offersCheckedAt: Date | null;
  /** In the order they were added, the same order as the plan's snapshot. */
  readonly members: readonly { readonly id: string; readonly currency: string }[];
  /** In the order the plan lists them. */
  readonly picks: readonly StoredPick[];
  /** The query behind each search id the picks refer to, to run it again. */
  readonly queries: ReadonlyMap<string, OfferQuery>;
}

export interface RenewedPick {
  readonly pickId: string;
  readonly offer: Offer;
}

export interface PlanDetailsStore {
  load(planId: string): Promise<Result<PlanDetails, RepositoryError>>;
  /**
   * Starts a check of the offers unless one started less than `cooldownMs` ago. Returns whether this caller
   * won it, so concurrent callers (a page load, a poll, an approval) never search the same plan twice at once.
   */
  claimRefresh(planId: string, now: Date, cooldownMs: number): Promise<Result<boolean, RepositoryError>>;
  /** Replaces the stored offers of these picks with their renewed versions. */
  saveRenewal(planId: string, renewed: readonly RenewedPick[]): Promise<Result<void, RepositoryError>>;
  /** Plans that can still be expired whose deadline has passed, oldest first. */
  listPastDeadline(now: Date, limit: number): Promise<Result<readonly string[], RepositoryError>>;
}
