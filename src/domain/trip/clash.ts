export interface DatedTrip {
  readonly departDate: string;
  readonly returnDate: string;
}

/**
 * The first booked trip whose days overlap the new one, or null. Both ends count as taken, so leaving on the day
 * another trip returns is a clash. Dates are YYYY-MM-DD, which compare correctly as text.
 */
export function findClash<T extends DatedTrip>(trip: DatedTrip, booked: readonly T[]): T | null {
  return booked.find((other) => trip.departDate <= other.returnDate && other.departDate <= trip.returnDate) ?? null;
}
