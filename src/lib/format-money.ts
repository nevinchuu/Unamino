import { minorUnitExponent } from "@/domain/money/currency";

const DEFAULT_EXPONENT = 2;

/** Formats minor units for display, e.g. 7500 USD becomes "$75.00"; zero-decimal currencies like JPY are not divided. */
export function formatMinor(amountMinor: number, currency: string): string {
  const exponent = minorUnitExponent(currency) ?? DEFAULT_EXPONENT;
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amountMinor / 10 ** exponent);
}
