import { err, ok, type Result } from "@/lib/result";

/** The one part of the Stripe SDK this uses, so a fake can stand in for it in tests. */
export interface StripeConfirmLike {
  readonly paymentIntents: {
    confirm(id: string, params: { payment_method: string }): Promise<{ readonly status: string }>;
  };
}

/** Stripe's published test card. It only works with a test-mode key, and moves no money. */
const TEST_PAYMENT_METHOD = "pm_card_visa";

/** What a hold's client secret looks like: the hold's id, then the secret part. */
const SECRET_FORMAT = /^(pi_[A-Za-z0-9]+)_secret_/;

/**
 * Puts Stripe's test card on a hold from the server, for a simulated persona who has no browser to type a card into.
 * It refuses to exist for a live key: the one place real money could move is the one place this must never run.
 */
export class StripeTestCard {
  private constructor(private readonly client: StripeConfirmLike) {}

  /** Null unless the key is a test-mode key. */
  static forKey(secretKey: string, client: StripeConfirmLike): StripeTestCard | null {
    return secretKey.startsWith("sk_test_") ? new StripeTestCard(client) : null;
  }

  /** Confirms the hold with the test card. The hold is then waiting to be recorded, as when a person confirms in the browser. */
  async place(clientSecret: string): Promise<Result<void, string>> {
    const id = SECRET_FORMAT.exec(clientSecret)?.[1];
    if (!id) return err("That is not a hold's secret.");
    try {
      const confirmed = await this.client.paymentIntents.confirm(id, { payment_method: TEST_PAYMENT_METHOD });
      return confirmed.status === "requires_capture" ? ok(undefined) : err(`The test card did not go through (${confirmed.status}).`);
    } catch {
      return err("Stripe could not be reached.");
    }
  }
}
