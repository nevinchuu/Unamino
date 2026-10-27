import { err, ok, type Result } from "@/lib/result";
import { minorUnitExponent } from "@/domain/money/currency";
import type { FxRateTable, SplitError } from "./types";

const ROUNDING_PRECISION = 6;

/** Rounds up to a whole minor unit, ignoring float noise such as 100.00000000001. */
const ceilMinor = (value: number): number => Math.ceil(Number(value.toFixed(ROUNDING_PRECISION)));

const ratePerBase = (table: FxRateTable, currency: string): number | null => {
  if (currency === table.baseCurrency) return 1;
  const rate = table.ratesPerBase[currency];
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : null;
};

/** Units of `to` per 1 unit of `from`, or null if either currency has no usable rate. */
export function rateBetween(table: FxRateTable, from: string, to: string): number | null {
  const fromRate = ratePerBase(table, from);
  const toRate = ratePerBase(table, to);
  return fromRate === null || toRate === null ? null : toRate / fromRate;
}

/** Converts minor units between currencies, rounding up so a hold never falls short. */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  table: FxRateTable,
): Result<number, SplitError> {
  if (from === to) return ok(amountMinor);
  const fromExponent = minorUnitExponent(from);
  const toExponent = minorUnitExponent(to);
  if (fromExponent === null || toExponent === null) {
    return err({ code: "invalid_currency", message: `Unsupported currency code in ${from} to ${to}` });
  }
  const rate = rateBetween(table, from, to);
  if (rate === null) {
    return err({ code: "missing_rate", message: `No exchange rate for ${from} to ${to} in ${table.source}` });
  }
  const targetMajor = (amountMinor / 10 ** fromExponent) * rate;
  return ok(ceilMinor(targetMajor * 10 ** toExponent));
}
