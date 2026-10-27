export type ScheduleEntryKind = "flight" | "hotel_check_in" | "hotel_check_out" | "activity";

/** One thing on the timeline. Times are local wall-clock time at the place, "HH:mm". */
export interface ScheduleEntry {
  readonly kind: ScheduleEntryKind;
  readonly offerId: string;
  readonly title: string;
  /** Who is there. A flight or room is only for its own members. */
  readonly memberIds: readonly string[];
  readonly date: string;
  /** Null when the source gives no time, e.g. a hotel check-in. */
  readonly startTime: string | null;
  readonly endTime: string | null;
  /** Set when the entry ends on a later date, e.g. a flight that lands after midnight. */
  readonly endsOn: string | null;
}

export interface ScheduleDay {
  readonly date: string;
  readonly entries: readonly ScheduleEntry[];
}

/** Time when the whole group is in the city and nothing is booked, so one idea can suit everyone. */
export interface FreeGap {
  readonly id: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly minutes: number;
}

export interface Schedule {
  readonly days: readonly ScheduleDay[];
  readonly gaps: readonly FreeGap[];
}

export type ScheduleErrorCode = "missing_flights";

export interface ScheduleError {
  readonly code: ScheduleErrorCode;
  readonly message: string;
}
