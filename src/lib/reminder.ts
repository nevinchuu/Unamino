import { listOf } from "./plan-card";

export type ReminderStep = "agree" | "approve";

/** A reminder starts with a chat line with this in it, which is how a second one is held back for a while. */
export const REMINDER_MARKER = " asked Trippy to nudge ";

/** How long the group is left alone after a reminder, so nobody is nagged by a button pressed twice. */
export const REMINDER_COOLDOWN_MS = 5 * 60_000;

/**
 * The chat line that says who asked for a nudge and who it is for, in fixed words. Null when nobody is waited for.
 * It names people who are already in the group and says nothing else.
 */
export function reminderLine(sender: string, waiting: readonly string[]): string | null {
  if (waiting.length === 0) return null;
  return `${sender}${REMINDER_MARKER}${listOf(waiting)}.`;
}

/** What a nudge says to one person when Trippy cannot word it: only what the plan needs from them, and that nothing is charged yet. */
export function fallbackNudge(name: string, step: ReminderStep): string {
  return step === "agree"
    ? `${name}, the plan is waiting for you to agree. Agreeing costs nothing and your money is not touched.`
    : `${name}, the plan is waiting for you to approve your amount and add a card. Nothing is charged until everyone has approved and the trip is booked.`;
}
