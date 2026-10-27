import { MINUTES_PER_DAY, weekdayOf } from "./time";

export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/** A stretch of the week, in minutes from Sunday 00:00. `closeMinute` passes one week when it runs past Saturday night. */
export interface WeekInterval {
  readonly openMinute: number;
  readonly closeMinute: number;
}

export type OpeningHours =
  | { readonly kind: "always" }
  | { readonly kind: "periods"; readonly intervals: readonly WeekInterval[] };

/** A point in the week the way Google writes it: day 0 is Sunday. */
export interface WeekPoint {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface WeekPeriod {
  readonly open: WeekPoint;
  readonly close?: WeekPoint;
}

const minuteOfWeek = (point: WeekPoint): number => point.day * MINUTES_PER_DAY + point.hour * 60 + point.minute;

const isMidnightSunday = (point: WeekPoint): boolean => point.day === 0 && point.hour === 0 && point.minute === 0;

/** Joins stretches that touch or overlap, e.g. 11:00-15:00 and 15:00-22:00. */
function mergeIntervals(intervals: readonly WeekInterval[]): readonly WeekInterval[] {
  const merged: WeekInterval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.openMinute - b.openMinute)) {
    const last = merged[merged.length - 1];
    if (last && interval.openMinute <= last.closeMinute) {
      merged[merged.length - 1] = { openMinute: last.openMinute, closeMinute: Math.max(last.closeMinute, interval.closeMinute) };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/**
 * Turns Google's weekly periods into opening hours. Returns null when the hours cannot be trusted:
 * a period with no closing time that is not the "always open" marker.
 */
export function toOpeningHours(periods: readonly WeekPeriod[]): OpeningHours | null {
  if (periods.length === 1 && periods[0].close === undefined && isMidnightSunday(periods[0].open)) {
    return { kind: "always" };
  }
  const intervals: WeekInterval[] = [];
  for (const { open, close } of periods) {
    if (close === undefined) return null;
    const openMinute = minuteOfWeek(open);
    let closeMinute = minuteOfWeek(close);
    // Closing at or before opening means it closes after midnight into the next day, or next week.
    if (closeMinute <= openMinute) closeMinute += MINUTES_PER_WEEK;
    intervals.push({ openMinute, closeMinute });
  }
  return { kind: "periods", intervals: mergeIntervals(intervals) };
}

/** Is the place open for the whole of [startMinute, endMinute] on this date? Times are local minutes of the day. */
export function isOpenDuring(hours: OpeningHours, window: { date: string; startMinute: number; endMinute: number }): boolean {
  if (hours.kind === "always") return true;
  const dayStart = weekdayOf(window.date) * MINUTES_PER_DAY;
  const start = dayStart + window.startMinute;
  const end = dayStart + window.endMinute;
  // The same window one week later is covered by hours that wrap past Saturday night.
  return hours.intervals.some((interval) =>
    [0, MINUTES_PER_WEEK].some((shift) => interval.openMinute <= start + shift && end + shift <= interval.closeMinute),
  );
}
