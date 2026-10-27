export const PLAN_STATUSES = ["draft", "reviewing", "approving", "held", "booked", "captured", "expired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Step 1: does the member agree to the plan itself? No money is involved. */
export const PLAN_AGREEMENT_STATUSES = ["pending", "agreed", "declined"] as const;
export type PlanAgreementStatus = (typeof PLAN_AGREEMENT_STATUSES)[number];

/** Step 2: the member's approved amount and card hold. */
export const APPROVAL_STATUSES = ["pending", "approved", "declined", "needs_reapproval"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

const TERMINAL_PLAN_STATUSES: readonly PlanStatus[] = ["captured", "expired"];

/** A booked plan has everyone in, so the deadline can only expire plans that are not booked yet. */
export const EXPIRABLE_PLAN_STATUSES: readonly PlanStatus[] = ["draft", "reviewing", "approving", "held"];

export const isTerminalPlanStatus = (status: PlanStatus): boolean => TERMINAL_PLAN_STATUSES.includes(status);
