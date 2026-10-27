import type { Member } from "@/domain/group/types";
import type { HoldFailure, HoldService } from "@/domain/payments/hold-service";
import type { PlanViewStore } from "@/domain/plan/view-store";
import { isUuid } from "./ids";

/** What the browser needs to show Stripe's card form. The secret is for this person's hold only. */
export type CardFormResult =
  | { readonly ok: true; readonly clientSecret: string; readonly amountMinor: number; readonly currency: string; readonly status: "awaiting_card" | "held" }
  | { readonly ok: false; readonly error: string };

/** "placed": the hold is in. "waiting": the card has not gone through yet. "gone": the plan moved on, so there is nothing to place. */
export type ConfirmHoldResult = { readonly ok: true; readonly outcome: "placed" | "waiting" | "gone" } | { readonly ok: false; readonly error: string };

export interface HoldActionDeps {
  /** Null when this server does not take real card holds. */
  readonly holds: Pick<HoldService, "ensureHold" | "confirmHold"> | null;
  readonly views: Pick<PlanViewStore, "groupIdOf">;
}

const NOT_SIGNED_IN = "Open your invite link to rejoin this group.";
const NOT_FOUND = "We couldn't find that plan.";
const NOT_SET_UP = "Card payments are not set up on this server.";
const UNAVAILABLE = "Couldn't reach the payment service. Try again in a moment.";

/** What to tell a person when a hold step failed. Never the internal reason, which can name the payment provider's internals. */
export function describeHoldFailure(failure: HoldFailure): string {
  switch (failure.kind) {
    case "not_applicable":
      return "There's nothing to pay for right now.";
    case "mismatch":
      return "That card hold doesn't match this plan, so it wasn't recorded. Try again.";
    case "payment":
    case "store":
    case "plan":
      return UNAVAILABLE;
  }
}

/** The person must be in the plan's own group, checked here and not trusted from the page. Returns a message if not. */
async function checkAccess(deps: HoldActionDeps, member: Member | null, planId: string): Promise<string | null> {
  if (!member) return NOT_SIGNED_IN;
  if (!isUuid(planId)) return NOT_FOUND;
  const group = await deps.views.groupIdOf(planId);
  if (!group.ok) return UNAVAILABLE;
  // A plan in someone else's group gets the same answer as a plan that does not exist.
  return group.value === member.groupId ? null : NOT_FOUND;
}

/** Makes the person's hold (or finds it) and hands their browser what it needs to show the card form. */
export async function runCardForm(deps: HoldActionDeps, member: Member | null, planId: string): Promise<CardFormResult> {
  const denied = await checkAccess(deps, member, planId);
  if (denied) return { ok: false, error: denied };
  if (!deps.holds || !member) return { ok: false, error: NOT_SET_UP };

  const form = await deps.holds.ensureHold(planId, member.id);
  if (!form.ok) {
    console.error("card form failed", form.error.kind);
    return { ok: false, error: describeHoldFailure(form.error) };
  }
  return { ok: true, clientSecret: form.value.clientSecret, amountMinor: form.value.amountMinor, currency: form.value.currency, status: form.value.status };
}

/** After the browser says the card was confirmed: asks the payment provider for the truth and records the hold if it is there. */
export async function runConfirmHold(deps: HoldActionDeps, member: Member | null, planId: string): Promise<ConfirmHoldResult> {
  const denied = await checkAccess(deps, member, planId);
  if (denied) return { ok: false, error: denied };
  if (!deps.holds || !member) return { ok: false, error: NOT_SET_UP };

  const confirmed = await deps.holds.confirmHold(planId, member.id);
  if (!confirmed.ok) {
    console.error("confirming a hold failed", confirmed.error.kind);
    return { ok: false, error: describeHoldFailure(confirmed.error) };
  }
  return { ok: true, outcome: confirmed.value.status };
}
