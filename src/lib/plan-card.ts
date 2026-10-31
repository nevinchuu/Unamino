import type { PlanStatus } from "@/domain/plan/statuses";
import type { IdeaDto, PlanItemDto } from "@/domain/plan/view";

/** Where one person in the plan stands, for the list of who has done what. */
export interface CardPerson {
  readonly name: string;
  readonly isMe: boolean;
  readonly agreed: boolean;
  /** They approved an amount; their card may still be to add. */
  readonly approved: boolean;
  readonly held: boolean;
}

/** What the card shows when it is opened in the chat: the picks the agent made, as on the plan screen. */
export interface CardDetail {
  /** "Fri 18 Dec to Mon 21 Dec · 4 people", or just the headcount when the dates are not set. */
  readonly subtitle: string;
  readonly items: readonly PlanItemDto[];
  readonly ideas: readonly IdeaDto[];
  /** What the whole trip costs at today's prices. Null when the shares cannot all be priced in the plan's currency. */
  readonly totalMinor: number | null;
  readonly currency: string;
}

/** What the plan means for the person looking at the chat, so the card can offer them the next step. */
export interface CardMine {
  readonly detail: CardDetail;
  /** They have not agreed yet, and may. */
  readonly canAgree: boolean;
  readonly agreed: boolean;
  /** They may still ask Trippy to change the plan. */
  readonly canRequestChanges: boolean;
  /** They may cover some or all of a friend's share: the plan is still open and has someone else in it. */
  readonly canCover: boolean;
  /** Their share, in `currency`'s minor units. The price the Agree button shows, and that the server checks again. */
  readonly shareMinor: number | null;
  readonly currency: string;
  /** What they would have paid on the plan this one replaced, when there was one and they were in it. */
  readonly previousShareMinor: number | null;
  /** The parts of their share, such as the flight and the hotel. Empty when the plan cannot be priced in their currency. */
  readonly lines: readonly { readonly label: string; readonly minor: number }[];
  readonly people: readonly CardPerson[];
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
  /** When the held prices run out (ISO time), for the countdown. */
  readonly deadlineAt: string;
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
  held: () => "Everyone's in. Getting ready to book",
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

/** "Ana", "Ana and Ben", "Ana, Ben and Jia". */
export function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Has this person done what the plan's stage asks of them: agreed while it is being agreed to, held their card while amounts are approved? Later stages ask nothing more of anyone. */
export function hasDoneTheirPart(status: PlanStatus, person: CardPerson): boolean {
  return status === "approving" ? person.held : status === "reviewing" || status === "draft" ? person.agreed : false;
}

export type SheetStep = "agree" | "approve";

export interface ActionSheetView {
  readonly step: SheetStep;
  /** Which of the three steps (agree, approve, book) this is, for the dots. */
  readonly stepNumber: 1 | 2;
  /** "2/4 agreed" or "1/4 in". */
  readonly pill: string;
  /** One quiet line of who is done and who the plan is waiting for. */
  readonly note: string;
  /** Something for this person to do now, as opposed to waiting. */
  readonly actionable: boolean;
  /** This person has done their part and others have not, so they may nudge them. */
  readonly canRemind: boolean;
}

/**
 * What the sheet above the composer says about the plan being decided: which step it is on and who is still to act.
 * Only plans being agreed to or paid for have a sheet; the chat never asks for one for any other status.
 */
export function describeSheet(plan: CardPlan, mine: CardMine): ActionSheetView {
  const step: SheetStep = plan.status === "approving" ? "approve" : "agree";
  const done = (person: CardPerson): boolean => hasDoneTheirPart(plan.status, person);
  const waiting = mine.people.filter((person) => !done(person));
  const waitingNames = waiting.map((person) => (person.isMe ? "you" : person.name));

  const finished = mine.people.filter((person) => done(person) && !person.isMe).map((person) => person.name);
  const verb = step === "approve" ? "in" : "agreed";
  // "Ana is in." or "Ana and Ben are in.", and "Ana agreed." for the first step.
  const finishedText = step === "approve" ? `${listOf(finished)} ${finished.length === 1 ? "is" : "are"} in.` : `${listOf(finished)} agreed.`;
  const parts = [
    finished.length > 0 ? finishedText : "",
    waitingNames.length > 0 ? `Waiting for ${listOf(waitingNames)}.` : "",
  ].filter((part) => part !== "");

  const count = mine.people.filter(done).length;
  return {
    step,
    stepNumber: step === "approve" ? 2 : 1,
    pill: `${count}/${plan.headcount} ${verb}`,
    note: parts.join(" "),
    actionable: step === "approve" ? mine.needsAmount : mine.canAgree && !mine.agreed,
    canRemind: waiting.length > 0 && !waiting.some((person) => person.isMe),
  };
}
