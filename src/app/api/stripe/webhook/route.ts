import { getContainer } from "@/server/container";
import { handleStripeWebhook } from "@/server/stripe-webhook";

/** Stripe tells us here when a card was confirmed on a hold. A server without real card holds accepts nothing. */
export async function POST(request: Request): Promise<Response> {
  const { payments } = getContainer();
  if (!payments.holds || !payments.webhook) return Response.json({ error: "not_configured" }, { status: 503 });
  return handleStripeWebhook(request, { secret: payments.webhook.secret, verify: payments.webhook.verify, store: payments.holdStore, holds: payments.holds });
}
