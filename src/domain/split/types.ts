export type SplitErrorCode =
  | "invalid_total"
  | "no_members"
  | "duplicate_member"
  | "unknown_member"
  | "no_line_items"
  | "member_has_no_share"
  | "invalid_share"
  | "shares_mismatch"
  | "invalid_cover"
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

/** Money one member moved onto, or off, another member's card. Base currency, minor units. */
export interface CoverLine {
  /** The other person: the one being covered, or the one covering. */
  readonly counterpartId: string;
  readonly direction: "covering" | "covered_by";
  readonly baseMinor: number;
}

/**
 * A friend paying some or all of another member's part. Three kinds: a fixed `amountBaseMinor` (the plan's base
 * currency, minor units); a `sharePercent` of the beneficiary's own part, which follows the price when it moves; or
 * neither, which is the whole of their part, however the price moves. At most one of the two is set. The trip total
 * does not change: the money only moves between cards.
 */
export interface Cover {
  readonly sponsorId: string;
  readonly beneficiaryId: string;
  readonly amountBaseMinor: number | null;
  readonly sharePercent?: number | null;
}

export interface MemberShare {
  readonly memberId: string;
  readonly currency: string;
  readonly lines: readonly ShareLine[];
  /** Sum of the member's own lines in the plan's base currency, minor units: what they take part in, before any cover. */
  readonly baseShareMinor: number;
  /** Covers that moved money onto or off this member. Empty when nobody covers anybody. */
  readonly coverLines: readonly CoverLine[];
  /** What this member's card pays in the member's currency, minor units, after covers. This is the amount to hold. Can be zero. */
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
