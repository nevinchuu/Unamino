export interface StackSplit<T> {
  readonly shown: readonly T[];
  /** How many people are left out of the row and counted in "+N". */
  readonly hiddenCount: number;
}

/** Which people a row of overlapping avatars draws, and how many are folded into "+N". A row never shows a lone "+1": that person gets their own avatar instead. */
export function splitForStack<T>(people: readonly T[], max: number): StackSplit<T> {
  const limit = Math.max(1, Math.floor(max));
  if (people.length <= limit + 1) return { shown: people, hiddenCount: 0 };
  return { shown: people.slice(0, limit), hiddenCount: people.length - limit };
}
