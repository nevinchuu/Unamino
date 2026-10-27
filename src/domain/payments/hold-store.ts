import type { Result } from "@/lib/result";
import type { ApprovalStatus, PlanStatus } from "@/domain/plan/statuses";

/** What is known about one member's hold in one plan. */
export interface HoldRecord {
  readonly planId: string;
  readonly memberId: string;
  readonly currency: string;
  readonly planStatus: PlanStatus;
  readonly approval: ApprovalStatus;
  /** The most they agreed to pay, and the amount a hold is made for. */
  readonly approvedMinor: number | null;
  /** Whether the plan has recorded that their card is on the hold. */
  readonly holdPlaced: boolean;
  /** The payment provider's id for their current hold, or null when there is none. */
  readonly holdId: string | null;
  readonly holdAttempt: number;
}

/** "not_found": no such member in that plan. "stale": the member has moved on to another hold since. "unavailable": the store could not be reached. */
export type HoldStoreErrorCode = "not_found" | "stale" | "unavailable";

export interface HoldStoreError {
  readonly code: HoldStoreErrorCode;
  readonly message: string;
}

export interface HoldStore {
  find(planId: string, memberId: string): Promise<Result<HoldRecord, HoldStoreError>>;
  /** Who a provider's hold belongs to, for when the provider tells us about it first (a webhook). */
  findByHoldId(holdId: string): Promise<Result<{ readonly planId: string; readonly memberId: string }, HoldStoreError>>;
  /**
   * Remembers the hold for the member's current attempt. Returns the id that is saved, which is the one already
   * there if another call got in first, so two calls at once end up on the same hold. "stale" if the member has
   * moved on to a later attempt.
   */
  saveHoldId(planId: string, memberId: string, attempt: number, holdId: string): Promise<Result<string, HoldStoreError>>;
  /** Forgets a hold that was let go of and moves on to the next attempt, so a new approval makes a new hold. Forgetting one that is already forgotten is fine. */
  clearHold(planId: string, memberId: string, holdId: string): Promise<Result<void, HoldStoreError>>;
}
