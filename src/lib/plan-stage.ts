import type { PlanViewDto } from "@/domain/plan/view";

export interface StageView {
  /** "Step 1 of 2" while people are deciding, otherwise null. */
  readonly step: string | null;
  readonly headline: string;
  readonly detail: string;
  /** "action": it is this person's turn. "waiting": they are done and the others are not. "good" and "ended" are final-ish. */
  readonly tone: "action" | "waiting" | "good" | "ended";
}

const count = (view: PlanViewDto, test: (person: PlanViewDto["people"][number]) => boolean): number => view.people.filter(test).length;

/** What the banner at the top of the plan says, from where the plan stands and where this person stands in it. */
export function describeStage(view: PlanViewDto): StageView {
  const { status, me } = view;
  const total = view.people.length;

  if (status === "expired") {
    if (view.failure) return { step: null, headline: "Booking didn't go through", detail: "Nothing was charged and every card hold was let go.", tone: "ended" };
    return {
      step: null,
      headline: "This plan ended",
      detail: view.replacedBy ? "A newer plan took its place." : "Mention @trippy in the chat to start a new one.",
      tone: "ended",
    };
  }
  if (status === "booking") return { step: null, headline: "Booking now", detail: "Everyone is in. The flights and hotel are being booked.", tone: "good" };
  if (status === "booked") return { step: null, headline: "Booked", detail: "Everything is booked. The cards are being charged.", tone: "good" };
  if (status === "captured") return { step: null, headline: "Booked and paid", detail: "The trip is booked and everyone has been charged.", tone: "good" };
  if (status === "held") return { step: null, headline: "Everyone's in", detail: "Every hold is in place. Booking is next.", tone: "good" };

  if (!me.inPlan) {
    return { step: null, headline: "You joined after this plan was made", detail: "Mention @trippy in the chat and it will make a plan that includes you.", tone: "waiting" };
  }

  if (status === "approving") {
    const approved = count(view, (person) => person.approval === "approved");
    // Approved, but the hold is not on their card yet: the next thing to do is theirs.
    if (me.cardNeeded) {
      return { step: "Step 2 of 2", headline: "Add your card", detail: "You've approved. Add a card to place your hold, so the trip can be booked once everyone has.", tone: "action" };
    }
    if (me.approval === "approved") return { step: "Step 2 of 2", headline: "You've approved", detail: `${approved} of ${total} have approved. Nothing is charged until everyone is in.`, tone: "waiting" };
    if (me.approval === "needs_reapproval") {
      return { step: "Step 2 of 2", headline: "Your price went up", detail: "It is now above what you approved. Approve the new amount to stay in.", tone: "action" };
    }
    return { step: "Step 2 of 2", headline: "Approve your amount", detail: "This is the most you'll be charged. Nothing is taken until everyone is in and the trip is booked.", tone: "action" };
  }

  // Reviewing, or a draft that is about to be.
  const agreed = count(view, (person) => person.agreement === "agreed");
  if (me.agreement === "agreed") return { step: "Step 1 of 2", headline: "You agreed", detail: `${agreed} of ${total} have agreed. Waiting for ${total - agreed} more.`, tone: "waiting" };
  return { step: "Step 1 of 2", headline: "Look over the plan", detail: `${agreed} of ${total} have agreed. Nothing is charged at this step.`, tone: "action" };
}

/** Has the time the prices were held for run out? The screen then says they are being checked again, not that time is up, because the prices are renewed in the background. */
export const priceHoldElapsed = (deadline: Date, now: Date): boolean => deadline.getTime() <= now.getTime();

/** Under this long left, the countdown turns into a warning. */
const URGENT_SECONDS = 120;

/** "9:41", or "1:05:00" over an hour. Rounded up like `countdownText`, and never below "0:00". */
export function clockText(deadline: Date, now: Date): string {
  const total = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Few enough minutes left that the group should hurry. False once the time has run out: the prices are renewed then, not lost. */
export function isUrgent(deadline: Date, now: Date): boolean {
  const seconds = Math.ceil((deadline.getTime() - now.getTime()) / 1000);
  return seconds > 0 && seconds <= URGENT_SECONDS;
}

/** "8 min left", "45 sec left", or "Time's up". Rounded up, so the last second is not shown as zero. */
export function countdownText(deadline: Date, now: Date): string {
  const seconds = Math.ceil((deadline.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return "Time's up";
  if (seconds < 60) return `${seconds} sec left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr left` : `${hours} hr ${rest} min left`;
}
