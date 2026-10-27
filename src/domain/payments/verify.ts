import type { Hold, HoldOwner } from "./types";

export type HoldCheck = { readonly ok: true } | { readonly ok: false; readonly reason: "not_held" | "wrong_owner" | "wrong_amount" | "wrong_currency" };

/**
 * Is this really the hold the plan is waiting for? A hold only counts when the card was confirmed, it belongs to
 * this member in this plan, and it is for exactly the amount they approved. What a browser says about its own
 * hold is never taken on trust: the provider is asked, and its answer is checked here.
 */
export function checkHold(hold: Hold, expected: { readonly owner: HoldOwner; readonly amountMinor: number; readonly currency: string }): HoldCheck {
  if (hold.owner.planId !== expected.owner.planId || hold.owner.memberId !== expected.owner.memberId) return { ok: false, reason: "wrong_owner" };
  if (hold.currency.toUpperCase() !== expected.currency.toUpperCase()) return { ok: false, reason: "wrong_currency" };
  if (hold.amountMinor !== expected.amountMinor) return { ok: false, reason: "wrong_amount" };
  // Held in full: a hold for less than was approved would let the trip be booked without covering the share.
  if (hold.status !== "held" || hold.heldMinor !== expected.amountMinor) return { ok: false, reason: "not_held" };
  return { ok: true };
}
