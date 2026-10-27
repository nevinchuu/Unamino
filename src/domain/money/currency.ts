const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/**
 * Number of decimal places between a currency's major and minor unit (USD 2, JPY 0).
 * Returns null for a malformed or unknown code.
 */
export function minorUnitExponent(currency: string): number | null {
  if (!CURRENCY_CODE_PATTERN.test(currency)) return null;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

/**
 * Converts a price quoted in major units (304.55) to whole minor units (30455).
 * Returns null when the amount is not a positive finite number or the currency is unknown.
 */
export function toMinorUnits(amountMajor: number, currency: string): number | null {
  const exponent = minorUnitExponent(currency);
  if (exponent === null || !Number.isFinite(amountMajor) || amountMajor <= 0) return null;
  // Rounding absorbs float noise such as 304.55 * 100 = 30455.000000000004
  const minor = Math.round(amountMajor * 10 ** exponent);
  return minor > 0 ? minor : null;
}

export const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;
