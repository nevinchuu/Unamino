/**
 * A short code the group can quote for a paid trip, such as "UN-7F3A2C". It is made from the plan's id, so the same
 * plan always has the same code. It is this app's own reference: it is not an airline or hotel booking number.
 */
export function planReference(planId: string): string {
  const letters = planId.replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase();
  return `UN-${letters.padEnd(6, "0")}`;
}
