/**
 * How long personal data is kept. These numbers are the single source for the deletion job, the notices people see and
 * the privacy page, so what is promised is what is done.
 */
export const RETENTION = {
  /** A group with a booked trip is deleted this long after the trip ends, so people can still open their confirmation while travelling. */
  daysAfterTrip: 30,
  /** A group that never booked a trip is deleted after this long without a message. */
  daysInactive: 30,
  /** The small record kept for disputes: no chat, no contact details. About 18 months, to outlast a card dispute window. */
  recordDaysAfterTrip: 540,
} as const;

const DAY_MS = 24 * 60 * 60_000;

/** `date` is "YYYY-MM-DD". Worked in UTC, so the answer never depends on where the server runs. */
function addDays(date: string, days: number): string | null {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  return Number.isNaN(parsed) ? null : new Date(parsed + days * DAY_MS).toISOString().slice(0, 10);
}

/** The trip's last day: the return date, or the departure date for a trip with no return. Null when neither is known. */
export function tripEndOf(trip: { readonly departDate: string | null; readonly returnDate: string | null }): string | null {
  return trip.returnDate ?? trip.departDate;
}

/** The day a booked trip's chat, plans and booking details are deleted, "YYYY-MM-DD". Null when the trip has no dates. */
export function tripKeptUntil(trip: { readonly departDate: string | null; readonly returnDate: string | null }): string | null {
  const end = tripEndOf(trip);
  return end === null ? null : addDays(end, RETENTION.daysAfterTrip);
}

/** The day the dispute record is deleted, "YYYY-MM-DD". Null when the trip has no dates. */
export function recordKeptUntil(trip: { readonly departDate: string | null; readonly returnDate: string | null }): string | null {
  const end = tripEndOf(trip);
  return end === null ? null : addDays(end, RETENTION.recordDaysAfterTrip);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "14 Jan 2027" from "2027-01-14". The input is returned unchanged if it is not a date, so a notice never shows "NaN". */
export function formatKeptUntil(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : date;
}
