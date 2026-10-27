import type { HoldService } from "@/domain/payments/hold-service";
import type { HoldStore } from "@/domain/payments/hold-store";

/** The parts of a Stripe event this reads. */
export interface StripeEventLike {
  readonly id: string;
  readonly type: string;
  readonly data: { readonly object: { readonly id?: unknown } };
}

export interface StripeWebhookDeps {
  /** Without it nothing is accepted, so a server that was never given the secret cannot be fed made-up events. */
  readonly secret: string | null;
  /** Checks Stripe's signature on the exact bytes that were sent, and returns the event. Throws if it does not match. */
  readonly verify: (body: string, signature: string, secret: string) => StripeEventLike;
  readonly store: Pick<HoldStore, "findByHoldId">;
  readonly holds: Pick<HoldService, "confirmHold">;
}

const respond = (status: number, body: Record<string, unknown>): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The event that says a card was confirmed and the amount is now set aside. */
const HOLD_PLACED_EVENT = "payment_intent.amount_capturable_updated";

/**
 * What Stripe tells us when something happens to a hold. The browser reports a placed hold too, but it may be
 * closed before it can, so this makes sure the plan hears about it either way. The event only says which hold to
 * look at: the hold service asks Stripe for the real state and checks it, so a forged or replayed event cannot
 * place a hold that is not there.
 */
export async function handleStripeWebhook(request: Request, deps: StripeWebhookDeps): Promise<Response> {
  if (!deps.secret) return respond(503, { error: "not_configured" });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return respond(400, { error: "no_signature" });

  // The signature covers the exact bytes, so the body is read as text and not parsed first.
  const body = await request.text();
  let event: StripeEventLike;
  try {
    event = deps.verify(body, signature, deps.secret);
  } catch {
    return respond(400, { error: "bad_signature" });
  }

  if (event.type !== HOLD_PLACED_EVENT) return respond(200, { received: true, handled: false });
  const holdId = event.data.object.id;
  if (typeof holdId !== "string") return respond(200, { received: true, handled: false });

  const owner = await deps.store.findByHoldId(holdId);
  if (!owner.ok) {
    // Not one of ours (another product on the same account, or a hold that was forgotten): nothing to do, and retrying cannot help.
    if (owner.error.code === "not_found") return respond(200, { received: true, handled: false });
    return respond(500, { error: "unavailable" });
  }

  const confirmed = await deps.holds.confirmHold(owner.value.planId, owner.value.memberId);
  if (!confirmed.ok) {
    // A failure to reach Stripe or the database is worth Stripe trying again; anything else would fail the same way again.
    console.error("stripe webhook could not confirm a hold", confirmed.error.kind);
    return confirmed.error.kind === "payment" || confirmed.error.kind === "store" ? respond(500, { error: "unavailable" }) : respond(200, { received: true, handled: false });
  }
  return respond(200, { received: true, handled: true, outcome: confirmed.value.status });
}
