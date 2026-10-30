/**
 * Why a booking was given up on.
 * "price": a supplier now wants more than the offer said. "unavailable": the offer is gone. "rejected": a supplier
 * refused what we sent. "temporary": a supplier could not be reached, so trying again may work. "details": someone's
 * traveller details were missing. "hold": a card hold was no longer good. "deadline": the plan ran out of time.
 * "stuck": booking took too long. "other": anything else.
 */
export const BOOKING_FAILURE_KINDS = ["price", "unavailable", "rejected", "temporary", "details", "hold", "deadline", "stuck", "other"] as const;
export type BookingFailureKind = (typeof BOOKING_FAILURE_KINDS)[number];

export type PartKind = "hotel" | "flight";

/** The one hotel or flight that could not be booked. `listingId` is the supplier's stable id for it, so it can be kept out of the next plan. */
export interface FailedPart {
  readonly pickId: string;
  readonly kind: PartKind;
  readonly title: string;
  readonly listingId: string;
  /** What the offer said it would cost, in minor units of `currency`. A price above this is what makes a supplier refuse. */
  readonly offeredMinor: number;
  readonly currency: string;
}

/** A booking that had been made and was cancelled again because another part failed. */
export interface UndonePart {
  readonly kind: PartKind;
  readonly title: string;
}

/** What is kept about a failed booking: which part, why, and what was undone, so the group and Trippy can plan something different. */
export interface BookingFailureRecord {
  readonly planId: string;
  readonly reason: BookingFailureKind;
  /** Null when no single hotel or flight is to blame, such as a missing detail or a lost card hold. */
  readonly part: FailedPart | null;
  readonly undone: readonly UndonePart[];
  /** Whether the same plan may work if it is tried again: only for a supplier that could not be reached. */
  readonly retryable: boolean;
}

/** A supplier that could not be reached may answer next time. Everything else would fail the same way again. */
export const isRetryable = (reason: BookingFailureKind): boolean => reason === "temporary";

const MAX_NAME_LENGTH = 50;

/** A name short enough for a chat line: a listing's own title often runs on into its address and landmarks. */
export function shortName(title: string): string {
  const first = title.split(" - ")[0].replace(/\s+/g, " ").trim();
  const name = first.length > 0 ? first : title.trim();
  return name.length <= MAX_NAME_LENGTH ? name : `${name.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
}
