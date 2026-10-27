export const PLAN_STATUSES = ["draft", "reviewing", "approving", "held", "booking", "booked", "captured", "expired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Step 1: does the member agree to the plan itself? No money is involved. */
export const PLAN_AGREEMENT_STATUSES = ["pending", "agreed", "declined"] as const;
export type PlanAgreementStatus = (typeof PLAN_AGREEMENT_STATUSES)[number];

/** Step 2: the member's approved amount and card hold. */
export const APPROVAL_STATUSES = ["pending", "approved", "declined", "needs_reapproval"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

const TERMINAL_PLAN_STATUSES: readonly PlanStatus[] = ["captured", "expired"];

/**
 * Once booking has started, bookings may exist at the airline and the hotel, so the plan can no longer be expired
 * by the deadline or replaced: only booking itself can end it.
 */
export const EXPIRABLE_PLAN_STATUSES: readonly PlanStatus[] = ["draft", "reviewing", "approving", "held"];

export const isTerminalPlanStatus = (status: PlanStatus): boolean => TERMINAL_PLAN_STATUSES.includes(status);
