import type { PlanStatus } from "@/domain/plan/statuses";

/** The newest plan, as the chat knows it. */
export interface LatestPlan {
  readonly id: string;
  readonly title: string;
  readonly status: PlanStatus;
  readonly headcount: number;
  readonly agreedCount: number;
}

export interface PlanCardView {
  /** "live" is the plan the group is working on; "replaced" is an earlier one a newer plan took over from. */
  readonly state: "live" | "replaced" | "gone";
  readonly title: string;
  readonly detail: string;
  readonly people: string | null;
}

const STATUS_DETAIL: Record<PlanStatus, (plan: LatestPlan) => string> = {
  draft: (plan) => `${plan.agreedCount} of ${plan.headcount} agreed`,
  reviewing: (plan) => `${plan.agreedCount} of ${plan.headcount} agreed`,
  approving: () => "Everyone agreed. Now each person approves their amount",
  held: () => "Everyone approved. Getting ready to book",
  booking: () => "Booking now",
  booked: () => "Booked. Taking payment",
  captured: () => "Booked and paid",
  expired: () => "This plan ended",
};

/** What the card under an agent message says about the plan it announced. Only the newest plan is live. */
export function describePlanCard(planId: string, latest: LatestPlan | null): PlanCardView {
  if (!latest) return { state: "gone", title: "Trip plan", detail: "This plan is no longer available", people: null };
  if (latest.id !== planId) return { state: "replaced", title: "Earlier plan", detail: "Replaced by a newer plan", people: null };
  return { state: "live", title: latest.title, detail: STATUS_DETAIL[latest.status](latest), people: `${latest.headcount} ${latest.headcount === 1 ? "person" : "people"}` };
}
