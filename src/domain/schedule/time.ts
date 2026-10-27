import { clockTime } from "@/domain/offers/local-time";

export const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;
const DATE_LENGTH = "YYYY-MM-DD".length;

/** "14:30" to 870. Input must already be a valid "HH:mm". */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** 870 to "14:30". */
export const formatMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Day of the week for a calendar date: 0 is Sunday, 6 is Saturday. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Minutes from a fixed point in time to the start of the given date. Only the differences are meaningful. */
const dayStartMinutes = (date: string): number => Date.parse(`${date}T00:00:00Z`) / MS_PER_MINUTE;

/** A date and clock time as one number of minutes, so moments on different days can be compared and subtracted. */
export const absoluteMinutes = (date: string, minutesOfDay: number): number => dayStartMinutes(date) + minutesOfDay;

/** The calendar date that an absolute minute count falls on. */
export const dateOfAbsolute = (absolute: number): string => new Date(absolute * MS_PER_MINUTE).toISOString().slice(0, DATE_LENGTH);

/** Every date from `first` to `last`, inclusive. Empty if `last` is before `first`. */
export function datesBetween(first: string, last: string): readonly string[] {
  const dates: string[] = [];
  for (let day = dayStartMinutes(first); day <= dayStartMinutes(last); day += MINUTES_PER_DAY) {
    dates.push(dateOfAbsolute(day));
  }
  return dates;
}

export interface LocalMoment {
  readonly date: string;
  readonly minutes: number;
}

/**
 * Reads a flight time as the wall-clock date and time at that airport, ignoring any offset,
 * which is how both flight sources write departure and arrival times.
 */
export function localMoment(dateTime: string): LocalMoment | null {
  const time = clockTime(dateTime);
  return time === null ? null : { date: dateTime.slice(0, DATE_LENGTH), minutes: toMinutes(time) };
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

/** What is left of `base` after removing the `busy` spans. */
export function subtractSpans(base: Span, busy: readonly Span[]): readonly Span[] {
  let free: Span[] = [base];
  for (const taken of busy) {
    free = free.flatMap((span) => {
      if (taken.end <= span.start || taken.start >= span.end) return [span];
      const pieces: Span[] = [];
      if (taken.start > span.start) pieces.push({ start: span.start, end: taken.start });
      if (taken.end < span.end) pieces.push({ start: taken.end, end: span.end });
      return pieces;
    });
  }
  return free;
}
