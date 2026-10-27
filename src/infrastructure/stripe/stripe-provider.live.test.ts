import { describe, expect, it } from "vitest";
import { describePaymentProviderContract } from "@/domain/payments/contract";
import { createStripeClient } from "./stripe-client";
import { StripePaymentProvider } from "./stripe-provider";

/**
 * The payment provider contract against Stripe's real TEST mode, with Stripe's published test card. It is how the
 * rules in the contract were found to be true, and it is skipped unless asked for:
 *   STRIPE_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run stripe-provider.live
 * It refuses to run with any key that is not a test key. It makes test-mode holds only; no money moves.
 */
const LIVE = process.env.STRIPE_LIVE === "1";

describe.skipIf(!LIVE)("Stripe's test mode", () => {
  const key = process.env.STRIPE_SECRET_KEY ?? "";

  it("is only ever run with a test key", () => {
    expect(key.startsWith("sk_test_")).toBe(true);
  });

  if (key.startsWith("sk_test_")) {
    const client = createStripeClient(key);
    describePaymentProviderContract(
      "real Stripe (test mode)",
      () => ({
        provider: new StripePaymentProvider(client),
        // What the browser's card form does, with Stripe's published test card.
        completeCard: async (id) => {
          await client.paymentIntents.confirm(id, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
        },
      }),
      { timeoutMs: 30_000 },
    );
  }
});
