export const CHANGE_REASONS = ["too_expensive", "different_dates", "different_pick", "other"] as const;
export type ChangeReason = (typeof CHANGE_REASONS)[number];

/** How long the optional note may be. Short, because it goes into the chat as part of the message. */
export const NOTE_MAX = 200;

const PHRASES: Readonly<Record<ChangeReason, string>> = {
  too_expensive: "it is too expensive for me",
  different_dates: "the dates do not work for me",
  different_pick: "I would like a different flight or hotel",
  other: "something needs to change",
};

export const isChangeReason = (value: unknown): value is ChangeReason => typeof value === "string" && (CHANGE_REASONS as readonly string[]).includes(value);

/** One line, trimmed and cut to length: a note cannot carry line breaks into the chat. */
export const cleanNote = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) : "");

/** What the person's request says in the chat. Written so Trippy reads it as a request to adjust the plan, not to end it. */
export function changeRequestText(reason: ChangeReason, note: string, shareText: string | null): string {
  const share = reason === "too_expensive" && shareText ? ` (my share is ${shareText})` : "";
  return `@trippy I need changes to the plan: ${PHRASES[reason]}${share}.${note ? ` ${note}` : ""}`;
}
