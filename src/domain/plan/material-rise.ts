/** A price rise of more than this share, in percent, sends the group back to look at the plan again. */
export const MATERIAL_RISE_PERCENT = 5;

/**
 * Has the price risen by more than the threshold since the member agreed? Measured against the price they
 * saw, not the last check, so small rises cannot add up unnoticed. Integer arithmetic only, minor units.
 */
export const isMaterialRise = (agreedMinor: number, currentMinor: number): boolean =>
  currentMinor * 100 > agreedMinor * (100 + MATERIAL_RISE_PERCENT);
