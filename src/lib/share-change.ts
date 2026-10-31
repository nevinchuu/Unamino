import { formatMinor } from "./format-money";

/** What the previous plan would have cost them, as a short note under their amount. Null when there was no previous plan, they were not in it, or the amount did not move. */
export function previousShareNote(currentMinor: number | null, previousMinor: number | null, currency: string): string | null {
  if (currentMinor === null || previousMinor === null || currentMinor === previousMinor) return null;
  return `Was ${formatMinor(previousMinor, currency)} on the previous plan`;
}
