import { err, ok, type Result } from "@/lib/result";

export const DEFAULT_PLAN_WINDOW_MS = 48 * 60 * 60 * 1000;

export type DeadlineErrorCode = "invalid_window" | "no_offers" | "deadline_already_passed";

export interface DeadlineError {
  readonly code: DeadlineErrorCode;
  readonly message: string;
}

interface Expiring {
  readonly expiresAt: string;
}

/** The earliest expiry among the offers, or null if there are none. */
export function earliestExpiry(offers: readonly Expiring[]): Date | null {
  if (offers.length === 0) return null;
  return new Date(Math.min(...offers.map((offer) => new Date(offer.expiresAt).getTime())));
}

export interface PlanDeadlines {
  /** Follows the offers: the earliest offer expiry, but never past the hard cap. */
  readonly deadlineAt: Date;
  /** The creation time plus the window. Nothing can extend the plan beyond this. */
  readonly hardDeadlineAt: Date;
}

/**
 * The deadlines of a plan that is being created or recreated now. Offers that are already
 * expired give an error, because a plan cannot start with nothing left to approve.
 */
export function computePlanDeadlines(input: {
  readonly createdAt: Date;
  readonly offers: readonly Expiring[];
  readonly windowMs?: number;
}): Result<PlanDeadlines, DeadlineError> {
  const { createdAt, offers, windowMs = DEFAULT_PLAN_WINDOW_MS } = input;
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return err({ code: "invalid_window", message: "The approval window must be a positive number of milliseconds" });
  }
  const earliest = earliestExpiry(offers);
  if (earliest === null) return err({ code: "no_offers", message: "A plan needs at least one offer" });
  if (earliest <= createdAt) {
    return err({ code: "deadline_already_passed", message: "An offer has already expired" });
  }
  const hardDeadlineAt = new Date(createdAt.getTime() + windowMs);
  return ok({ deadlineAt: earliest < hardDeadlineAt ? earliest : hardDeadlineAt, hardDeadlineAt });
}

/**
 * The deadline after the offers were checked again: the earliest new expiry, never past the hard cap.
 * Returns null if that is not later than the current deadline, i.e. there is nothing to extend.
 */
export function renewedDeadline(input: {
  readonly offers: readonly Expiring[];
  readonly currentDeadlineAt: Date;
  readonly hardDeadlineAt: Date;
}): Date | null {
  const earliest = earliestExpiry(input.offers);
  if (earliest === null) return null;
  const capped = earliest < input.hardDeadlineAt ? earliest : input.hardDeadlineAt;
  return capped > input.currentDeadlineAt ? capped : null;
}

/** An approved amount is valid until the plan deadline, so there is nothing to approve after it. */
export function computeApprovalExpiry(input: {
  readonly approvedAt: Date;
  readonly deadlineAt: Date;
}): Result<Date, DeadlineError> {
  if (input.approvedAt >= input.deadlineAt) {
    return err({ code: "deadline_already_passed", message: "The plan deadline has already passed" });
  }
  return ok(input.deadlineAt);
}
