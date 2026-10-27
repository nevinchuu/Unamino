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

export const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;
