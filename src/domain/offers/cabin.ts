/** Cabin classes from the cheapest seat to the dearest. The order matters: a higher cabin meets a need for a lower one. */
export const CABIN_CLASSES = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const cabinRank = (cabin: CabinClass): number => CABIN_CLASSES.indexOf(cabin);

const LABELS: Readonly<Record<CabinClass, string>> = {
  ECONOMY: "economy",
  PREMIUM_ECONOMY: "premium economy",
  BUSINESS: "business",
  FIRST: "first",
};

export const cabinLabel = (cabin: CabinClass): string => LABELS[cabin];

/** The strictest of several needs, or undefined when nobody asked for one. */
export function strictestCabin(needs: readonly (CabinClass | undefined)[]): CabinClass | undefined {
  return needs.reduce<CabinClass | undefined>((best, need) => (need !== undefined && (best === undefined || cabinRank(need) > cabinRank(best)) ? need : best), undefined);
}
