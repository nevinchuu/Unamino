export interface Interval<Owner> {
  readonly start: number;
  /** Exclusive: an interval may begin exactly when another ends. */
  readonly end: number;
  readonly owner: Owner;
}

/** Returns two intervals that overlap, or null if none do. */
export function findOverlappingPair<Owner>(
  intervals: readonly Interval<Owner>[],
): readonly [Interval<Owner>, Interval<Owner>] | null {
  const byStart = [...intervals].sort((a, b) => a.start - b.start);
  let latestEnding: Interval<Owner> | undefined;
  for (const interval of byStart) {
    if (latestEnding && interval.start < latestEnding.end) return [latestEnding, interval];
    if (!latestEnding || interval.end > latestEnding.end) latestEnding = interval;
  }
  return null;
}
