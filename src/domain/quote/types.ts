import type { ExcludedCharge, OfferKind } from "@/domain/offers/schema";
import type { ConstraintViolation } from "@/domain/planner/check-constraints";
import type { ShareLine } from "@/domain/split/types";

/** One thing being bought, as a person would read it. Prices are minor units of `currency`. */
export interface OfferQuote {
  readonly offerId: string;
  readonly listingId: string;
  readonly kind: OfferKind;
  readonly title: string;
  /** A short line of the details that tell offers apart, e.g. "Out 20:10, back 21:30". */
  readonly detail: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly memberIds: readonly string[];
  /** What each covered member pays for this offer, in the plan's currency. */
  readonly perMemberMinor: Readonly<Record<string, number>>;
  /** True if it can be cancelled for free, false if not, null when the source does not say. */
  readonly refundable: boolean | null;
  readonly freeCancellationUntil: string | null;
  readonly expiresAt: string;
  /** Charges collected on top of the price, shown so the total is not mistaken for everything. */
  readonly excludedCharges: readonly ExcludedCharge[];
}

export interface MemberBudget {
  readonly capMinor: number;
  /** Cap minus share. Negative means over budget. */
  readonly headroomMinor: number;
}

export interface MemberQuote {
  readonly memberId: string;
  readonly currency: string;
  readonly lines: readonly ShareLine[];
  /** In the plan's base currency. */
  readonly baseShareMinor: number;
  /** In the member's own currency: this is the amount they approve and the card hold. */
  readonly shareMinor: number;
  readonly fxRate: number;
  readonly fxSource: string;
  /** Null when the member set no budget, or set it in a different currency from the one they pay in. */
  readonly budget: MemberBudget | null;
}

/**
 * "ruled_out": swapping it in would break something a member asked for that the chosen plan does not.
 * "viable": it breaks nothing new. If the chosen plan already compromises someone, a viable alternative may
 * share that compromise; `fixes` lists the compromises it would remove.
 */
export type AlternativeStatus = "ruled_out" | "viable";

export interface Alternative {
  readonly offerId: string;
  readonly listingId: string;
  readonly title: string;
  readonly detail: string;
  readonly currency: string;
  readonly totalMinor: number;
  /** This offer's price minus the picked offer's. Negative means cheaper. */
  readonly priceDiffMinor: number;
  /** The same difference for each member the offer covers, in the plan's currency. */
  readonly memberDiffMinor: Readonly<Record<string, number>>;
  readonly status: AlternativeStatus;
  /** What it would break that the chosen plan does not. */
  readonly breaks: readonly ConstraintViolation[];
  /** What the chosen plan breaks that this one would not. */
  readonly fixes: readonly ConstraintViolation[];
  readonly expiresAt: string;
}

export interface SlotAlternatives {
  /** The picked offer these could replace. */
  readonly pickedOfferId: string;
  readonly alternatives: readonly Alternative[];
}

export interface PlanQuote {
  readonly currency: string;
  readonly totalMinor: number;
  readonly offers: readonly OfferQuote[];
  readonly members: readonly MemberQuote[];
  readonly alternatives: readonly SlotAlternatives[];
  /** Where the chosen plan still breaks what someone asked for. */
  readonly violations: readonly ConstraintViolation[];
}

/** What a member saw the last time they looked at their share, kept so the next view can show what moved. */
export interface SeenQuote {
  readonly currency: string;
  readonly shareMinor: number;
  readonly lines: readonly ShareLine[];
  readonly seenAt: string;
}

export interface LineChange {
  readonly itemId: string;
  readonly label: string;
  /** Null means the line was not there before. */
  readonly previousMinor: number | null;
  /** Null means the line is gone now. */
  readonly currentMinor: number | null;
  readonly deltaMinor: number;
}

export type PriceChange =
  | { readonly kind: "first_view" }
  | { readonly kind: "currency_changed"; readonly from: string; readonly to: string }
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "changed";
      /** Change in the member's own currency, which is what they approve. */
      readonly shareDeltaMinor: number;
      /** Per-line changes in the plan's base currency. */
      readonly lines: readonly LineChange[];
    };
