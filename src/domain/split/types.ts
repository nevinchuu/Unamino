export type SplitErrorCode =
  | "invalid_total"
  | "no_members"
  | "duplicate_member"
  | "unknown_member"
  | "no_line_items"
  | "member_has_no_share"
  | "invalid_share"
  | "shares_mismatch"
  | "invalid_currency"
  | "missing_rate";

export interface SplitError {
  readonly code: SplitErrorCode;
  readonly message: string;
}

/** How one cost is divided among the members it applies to. */
export type Allocation =
  | { readonly type: "equal"; readonly memberIds: readonly string[] }
  /** Exact amounts per member. They must add up to the item's total. */
  | { readonly type: "custom"; readonly amountsMinor: Readonly<Record<string, number>> };

/**
 * One cost in the plan's base currency, e.g. the flights (everyone), a triple room (three members)
 * or a cooking class (only those who join).
 */
export interface LineItem {
  readonly id: string;
  readonly label: string;
  readonly totalMinor: number;
  readonly allocation: Allocation;
}

export interface MemberInput {
  readonly id: string;
  readonly currency: string;
}

export interface ShareLine {
  readonly itemId: string;
  readonly label: string;
  /** This member's part of the line item, base currency, minor units. */
  readonly baseMinor: number;
}

export interface MemberShare {
  readonly memberId: string;
  readonly currency: string;
  readonly lines: readonly ShareLine[];
  /** Sum of the member's lines in the plan's base currency, minor units. */
  readonly baseShareMinor: number;
  /** The same share in the member's currency, minor units. This is the amount to hold. */
  readonly shareMinor: number;
  /** Units of the member's currency per 1 unit of the base currency. */
  readonly fxRate: number;
  readonly fxSource: string;
}

/** Rates are units of each currency per 1 unit of the base currency. The base currency is implicitly 1. */
export interface FxRateTable {
  readonly baseCurrency: string;
  readonly source: string;
  readonly ratesPerBase: Readonly<Record<string, number>>;
}
