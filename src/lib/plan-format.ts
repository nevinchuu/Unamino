const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MS_PER_DAY = 86_400_000;

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

interface Parts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly time: string | null;
}

/** Reads a date or a local date and time as written, without moving it to another time zone: a flight leaves at 20:10 on the clock at its airport. */
function parts(text: string): Parts | null {
  const match = DATE_TIME.exec(text);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), time: match[4] === undefined ? null : `${match[4]}:${match[5]}` };
}

const weekdayOf = (p: Parts): string => WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];

/** "Fri 11 Dec" from "2026-12-11" or "2026-12-11T20:10". Anything unreadable is returned as it was. */
export function shortDay(text: string): string {
  const p = parts(text);
  return p ? `${weekdayOf(p)} ${p.day} ${MONTHS[p.month - 1]}` : text;
}

/** "Fri 11 Dec, 20:10". A date with no time is just the day. */
export function dayAndTime(text: string): string {
  const p = parts(text);
  if (!p) return text;
  return p.time ? `${shortDay(text)}, ${p.time}` : shortDay(text);
}

/** "20:10" from a local date and time, or null when there is no time in it. */
export function clock(text: string): string | null {
  return parts(text)?.time ?? null;
}

/** Whole nights between two dates, or null if either is unreadable or the order is wrong. */
export function nightsBetween(checkIn: string, checkOut: string): number | null {
  const from = parts(checkIn);
  const to = parts(checkOut);
  if (!from || !to) return null;
  const nights = Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / MS_PER_DAY);
  return nights > 0 ? nights : null;
}

/** "Fri 11 Dec to Sun 13 Dec", or what is known of it. */
export function dateRange(departDate: string | null, returnDate: string | null): string | null {
  if (departDate && returnDate) return `${shortDay(departDate)} to ${shortDay(returnDate)}`;
  const only = departDate ?? returnDate;
  return only ? shortDay(only) : null;
}
