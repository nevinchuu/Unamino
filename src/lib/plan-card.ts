import type { PlanStatus } from "@/domain/plan/statuses";

/** What the plan means for the person looking at the chat, so the card can offer them the next step. */
export interface CardMine {
  /** They have not agreed yet, and may. */
  readonly canAgree: boolean;
  readonly agreed: boolean;
  /** Their share, in `currency`'s minor units. The price the Agree button shows, and that the server checks again. */
  readonly shareMinor: number | null;
  readonly currency: string;
  /** Everyone agreed and it is this person's turn to approve their amount or add their card. */
  readonly needsAmount: boolean;
}

/** One of the group's plans, as the chat knows it. */
export interface CardPlan {
  readonly id: string;
  readonly title: string;
  readonly status: PlanStatus;
  readonly headcount: number;
  readonly agreedCount: number;
  /** The plan that took this one over, when a newer plan replaced it. */
  readonly replacedById: string | null;
  /** Only on the group's newest open plan, and only for the person asking. Null everywhere else. */
  readonly mine?: CardMine | null;
}

export interface PlanCardView {
  /** "live" opens this plan, even one that has ended or been paid; "replaced" points on to the plan that took over. */
  readonly state: "live" | "replaced" | "gone";
  readonly title: string;
  readonly detail: string;
  readonly people: string | null;
  /** The plan a tap on the card opens, if any. */
  readonly opens: string | null;
}

const STATUS_DETAIL: Record<PlanStatus, (plan: CardPlan) => string> = {
  draft: (plan) => `${plan.agreedCount} of ${plan.headcount} agreed`,
  reviewing: (plan) => `${plan.agreedCount} of ${plan.headcount} agreed`,
  approving: () => "Everyone agreed. Now each person approves their amount",
  held: () => "Everyone approved. Getting ready to book",
  booking: () => "Booking now",
  booked: () => "Booked. Taking payment",
  captured: () => "Booked and paid",
  expired: () => "This plan ended",
};

/**
 * What the card under an agent message says about the plan it announced. Each card goes by its own plan: a trip that
 * was paid for stays "Booked and paid" even when the group has moved on to another one. Only a plan that a newer plan
 * took over from reads as replaced.
 */
export function describePlanCard(planId: string, plans: readonly CardPlan[]): PlanCardView {
  const plan = plans.find((candidate) => candidate.id === planId);
  if (!plan) return { state: "gone", title: "Trip plan", detail: "This plan is no longer available", people: null, opens: null };
  if (plan.replacedById) return { state: "replaced", title: "Earlier plan", detail: "Replaced by a newer plan", people: null, opens: plan.replacedById };
  return { state: "live", title: plan.title, detail: STATUS_DETAIL[plan.status](plan), people: `${plan.headcount} ${plan.headcount === 1 ? "person" : "people"}`, opens: plan.id };
}
