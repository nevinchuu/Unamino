import { listOf } from "./plan-card";

export type ReminderStep = "agree" | "approve";

/** A reminder is a chat line with this in it, which is how a second one is held back for a while. */
export const REMINDER_MARKER = " is waiting for ";

/** How long the group is left alone after a reminder, so nobody is nagged by a button pressed twice. */
export const REMINDER_COOLDOWN_MS = 5 * 60_000;

/**
 * The chat line that nudges the people a plan is waiting for, in fixed words. Null when nobody is waiting. It names people
 * who are already in the group and says only what the plan needs from them, nothing else.
 */
export function reminderLine(sender: string, step: ReminderStep, waiting: readonly string[]): string | null {
  if (waiting.length === 0) return null;
  const what = step === "agree" ? "agree to the plan" : "approve their amount and add a card";
  return `${sender}${REMINDER_MARKER}${listOf(waiting)} to ${what}.`;
}
