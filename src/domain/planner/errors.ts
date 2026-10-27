export type PlanValidationErrorCode =
  | "invalid_json"
  | "invalid_shape"
  | "duplicate_pick"
  | "unknown_offer"
  | "unknown_member"
  | "duplicate_member"
  | "guests_mismatch"
  | "expired_offer"
  | "mixed_currency"
  | "overlapping_hotels"
  | "overlapping_flights"
  | "member_not_covered";

export interface PlanValidationError {
  readonly code: PlanValidationErrorCode;
  readonly message: string;
  /** The offers at fault, so the planner can be told exactly what to change. */
  readonly offerIds?: readonly string[];
  readonly memberIds?: readonly string[];
}

export type PlannerErrorCode = "planner_unavailable" | "invalid_output";

/** What a planner reports when it cannot answer. `invalid_output` is worth retrying with feedback. */
export interface PlannerError {
  readonly code: PlannerErrorCode;
  readonly message: string;
}
