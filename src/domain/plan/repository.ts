import type { Result } from "@/lib/result";
import type { PlanSnapshot } from "./types";

/** A plan as it was read, with the version a save must quote. */
export interface StoredPlan {
  readonly id: string;
  /** The optimistic lock. A save only succeeds if the plan is still at this version. */
  readonly version: number;
  readonly plan: PlanSnapshot;
}

/**
 * "not_found": there is no such plan.
 * "version_conflict": someone else saved first. Reload and try again.
 * "member_mismatch": the snapshot's people are not the plan's people, which a transition never causes.
 * "unavailable": the store could not be reached.
 */
export type RepositoryErrorCode = "not_found" | "version_conflict" | "member_mismatch" | "unavailable";

export interface RepositoryError {
  readonly code: RepositoryErrorCode;
  readonly message: string;
}

export interface PlanRepository {
  load(planId: string): Promise<Result<StoredPlan, RepositoryError>>;
  /** Saves `next` only if the plan is still at `stored.version`, and returns it at the new version. */
  save(stored: StoredPlan, next: PlanSnapshot): Promise<Result<StoredPlan, RepositoryError>>;
}
