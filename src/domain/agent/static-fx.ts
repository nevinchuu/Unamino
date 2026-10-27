import { err, ok, type Result } from "@/lib/result";
import type { FxRateTable } from "@/domain/split/types";
import type { FxRates, StoreError } from "./ports";

/**
 * Fixed exchange rates, for the demo and tests. When everyone pays in the group's currency no rate is needed,
 * so no table has to be kept; a different currency with no rate is refused rather than guessed.
 */
export class StaticFxRates implements FxRates {
  constructor(
    private readonly ratesPerBase: Readonly<Record<string, number>> = {},
    private readonly source = "static-demo-rates",
  ) {}

  async forCurrencies(baseCurrency: string, currencies: readonly string[]): Promise<Result<FxRateTable, StoreError>> {
    const needed = [...new Set(currencies)].filter((currency) => currency !== baseCurrency);
    const missing = needed.filter((currency) => this.ratesPerBase[currency] === undefined);
    if (missing.length > 0) return err({ code: "unavailable", message: `No exchange rate from ${baseCurrency} to ${missing.join(", ")}` });
    return ok({ baseCurrency, source: needed.length === 0 ? "same-currency" : this.source, ratesPerBase: Object.fromEntries(needed.map((currency) => [currency, this.ratesPerBase[currency]])) });
  }
}
