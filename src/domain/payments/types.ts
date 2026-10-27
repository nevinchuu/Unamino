import type { Result } from "@/lib/result";

/**
 * How money is handled on this server. "stripe": real card holds, in Stripe's test mode while the key is a test key.
 * "demo": holds are only pretended, for trying the screens out. "none": nothing can be held.
 */
export type PaymentsMode = "stripe" | "demo" | "none";

/**
 * Where a card hold stands.
 * "awaiting_card": created, but no card has been entered and confirmed yet, or the last attempt failed.
 * "held": the card was confirmed and the amount is set aside. Nothing has been charged.
 * "captured": some or all of it was charged. Whatever was not charged was let go.
 * "released": let go without charging anything.
 */
export type HoldStatus = "awaiting_card" | "held" | "captured" | "released";

/** Who a hold is for. Ids only: no names or card details ever go to the payment provider. */
export interface HoldOwner {
  readonly planId: string;
  readonly memberId: string;
}

export interface Hold {
  /** The provider's id for it. Kept after the hold is released, so it can still be looked up. */
  readonly id: string;
  readonly status: HoldStatus;
  /** What the hold was made for: the most that can be charged. */
  readonly amountMinor: number;
  /** What is set aside right now. Zero until the card is confirmed, and zero again once it is captured or released. */
  readonly heldMinor: number;
  /** What was actually charged. Zero until captured. */
  readonly chargedMinor: number;
  readonly currency: string;
  readonly owner: HoldOwner;
  /** The secret the browser needs to show the card form for this hold. Only for the person it belongs to; never logged or stored. */
  readonly clientSecret: string | null;
  /** The reason the last card attempt failed, in the provider's words. For logs, not for people. */
  readonly lastError: string | null;
}

export interface HoldRequest {
  readonly amountMinor: number;
  readonly currency: string;
  readonly owner: HoldOwner;
  /** The same key always gives the same hold, so a retry can never set aside the money twice. */
  readonly idempotencyKey: string;
}

/**
 * "not_found": there is no such hold.
 * "amount_too_large": more was asked for than is held.
 * "invalid_state": the hold is not in a state that allows this (for example capturing one that was released).
 * "declined": the card was refused.
 * "invalid_request": the request itself was wrong.
 * "unavailable": the provider could not be reached or is not set up. Trying again later may work.
 */
export type PaymentErrorCode = "not_found" | "amount_too_large" | "invalid_state" | "declined" | "invalid_request" | "unavailable";

export interface PaymentError {
  readonly code: PaymentErrorCode;
  /** What went wrong, for logs. It can name the provider's internals, so it is never shown to people. */
  readonly message: string;
}

export interface PaymentProvider {
  /** Creates a hold for a card to be added to. Nothing is set aside until the card is confirmed in the browser. */
  createHold(request: HoldRequest): Promise<Result<Hold, PaymentError>>;
  getHold(holdId: string): Promise<Result<Hold, PaymentError>>;
  /** Charges `amountMinor` of the hold, up to what it holds, and lets go of the rest. Doing it again with the same amount is not an error. */
  capture(holdId: string, amountMinor: number, idempotencyKey: string): Promise<Result<Hold, PaymentError>>;
  /** Lets go of a hold without charging. Releasing one that is already released is not an error. */
  release(holdId: string, idempotencyKey: string): Promise<Result<Hold, PaymentError>>;
}
