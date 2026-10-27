export const PLAN_STATUSES = ["draft", "approving", "held", "booked", "captured", "expired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "declined", "needs_reapproval"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

const TERMINAL_PLAN_STATUSES: readonly PlanStatus[] = ["captured", "expired"];

/** A booked plan has everyone in, so the deadline can only expire plans that are not booked yet. */
export const EXPIRABLE_PLAN_STATUSES: readonly PlanStatus[] = ["draft", "approving", "held"];

export const isTerminalPlanStatus = (status: PlanStatus): boolean => TERMINAL_PLAN_STATUSES.includes(status);
