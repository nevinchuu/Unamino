import { EXPIRABLE_PLAN_STATUSES } from "./statuses";
import type { PlanSnapshot } from "./types";

/** True when the hard cap has passed. The plan must expire whatever the offers say. */
export function isPlanOverdue(plan: PlanSnapshot, now: Date): boolean {
  return EXPIRABLE_PLAN_STATUSES.includes(plan.status) && now >= plan.hardDeadlineAt;
}

/** True when the offers have run out but the hard cap has not: time to check them again. */
export function needsOfferRefresh(plan: PlanSnapshot, now: Date): boolean {
  return EXPIRABLE_PLAN_STATUSES.includes(plan.status) && now >= plan.deadlineAt && now < plan.hardDeadlineAt;
}
