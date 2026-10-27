/** How long a pause ends one run of messages from the same person and starts another. */
export const SAME_SENDER_GAP_MS = 5 * 60_000;

const MS_PER_DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The date as the reader's own calendar shows it. `timeZone` is for tests; in the browser it is left out and the device's own is used. */
function localDate(date: Date, timeZone?: string): { readonly year: number; readonly month: number; readonly day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** "2026-10-27": the same string for every moment of one calendar day. */
export function dayKey(date: Date, timeZone?: string): string {
  const { year, month, day } = localDate(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "14:05", the time on the reader's clock. */
export function clockTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** "Today", "Yesterday", or "Fri 11 Dec" for anything older. */
export function dayLabel(date: Date, now: Date, timeZone?: string): string {
  const day = localDate(date, timeZone);
  const today = localDate(now, timeZone);
  // Whole calendar days apart, worked out on the calendar itself so a clock change cannot make a day 23 or 25 hours long.
  const daysAgo = Math.round((Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(day.year, day.month - 1, day.day)) / MS_PER_DAY);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  const weekday = WEEKDAYS[new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()];
  return `${weekday} ${day.day} ${MONTHS[day.month - 1]}`;
}

export interface Placed {
  readonly kind: "human" | "agent" | "system";
  readonly senderId: string | null;
  readonly at: Date;
}

/** Does this message carry on from the one before, so the sender's name and picture are not repeated? */
export function continuesRun(previous: Placed | null, current: Placed, timeZone?: string): boolean {
  if (!previous || current.kind === "system" || previous.kind === "system") return false;
  if (previous.kind !== current.kind || previous.senderId !== current.senderId) return false;
  if (current.at.getTime() - previous.at.getTime() > SAME_SENDER_GAP_MS) return false;
  return dayKey(previous.at, timeZone) === dayKey(current.at, timeZone);
}

/** The first line of a message, cut to fit a quote, with an ellipsis when something was left out. */
export function snippet(body: string, max = 80): string {
  const firstLine = body.trim().split("\n", 1)[0].trim();
  const chars = Array.from(firstLine);
  const cut = chars.length > max || firstLine.length < body.trim().length;
  return cut ? `${chars.slice(0, max).join("").trimEnd()}\u2026` : firstLine;
}

export interface Laid<T> {
  readonly item: T;
  /** "Today", "Yesterday" or a date when this is the first message of its day, otherwise null. */
  readonly dayLabel: string | null;
  /** True when the sender's name and picture should be shown, because this starts a new run of messages. */
  readonly startsRun: boolean;
}

/** Works out where the day dividers and each sender's name go in a list of messages, oldest first. */
export function layoutMessages<T extends Placed>(items: readonly T[], now: Date, timeZone?: string): Laid<T>[] {
  return items.map((item, index) => {
    const previous = index > 0 ? items[index - 1] : null;
    const newDay = previous === null || dayKey(previous.at, timeZone) !== dayKey(item.at, timeZone);
    return { item, dayLabel: newDay ? dayLabel(item.at, now, timeZone) : null, startsRun: !continuesRun(previous, item, timeZone) };
  });
}
