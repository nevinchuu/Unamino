import type { StripeClientLike, StripePaymentIntentLike } from "./stripe-provider";

/** An error shaped like the ones the Stripe SDK throws, which is what the provider looks at. */
export class FakeStripeError extends Error {
  constructor(
    message: string,
    readonly type: string,
    readonly code: string | undefined,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

interface MutableIntent {
  id: string;
  status: string;
  amount: number;
  amount_capturable: number;
  amount_received: number;
  currency: string;
  client_secret: string | null;
  metadata: Record<string, string>;
  last_payment_error: { message?: string; code?: string } | null;
}

const unexpectedState = (id: string, status: string): FakeStripeError =>
  new FakeStripeError(`This PaymentIntent (${id}) has a status of ${status}, so that operation is not allowed.`, "StripeInvalidRequestError", "payment_intent_unexpected_state", 400);

/**
 * Stripe's PaymentIntent API for manual-capture holds, kept in memory, with the answers and errors Stripe gave
 * in its test mode (see the contract tests, which also run against the real thing).
 */
export class FakeStripeClient implements StripeClientLike {
  private readonly intents = new Map<string, MutableIntent>();
  private readonly byKey = new Map<string, string>();
  /** Every call made, in order, for tests that check what was or was not asked of Stripe. */
  readonly calls: string[] = [];
  /** Makes every call fail as if Stripe could not be reached, until cleared. */
  down = false;

  private reachable(call: string): void {
    this.calls.push(call);
    if (this.down) throw new Error("connect ECONNREFUSED");
  }

  private find(id: string): MutableIntent {
    const intent = this.intents.get(id);
    if (!intent) throw new FakeStripeError(`No such payment_intent: '${id}'`, "StripeInvalidRequestError", "resource_missing", 404);
    return intent;
  }

  readonly paymentIntents: StripeClientLike["paymentIntents"] = {
    create: async (params, options) => {
      this.reachable("create");
      const existing = this.byKey.get(options.idempotencyKey);
      if (existing) return this.find(existing);
      if (!Number.isInteger(params.amount) || params.amount <= 0) throw new FakeStripeError("Invalid positive integer", "StripeInvalidRequestError", "parameter_invalid_integer", 400);
      const intent: MutableIntent = {
        id: `pi_fake_${this.intents.size + 1}`,
        status: "requires_payment_method",
        amount: params.amount,
        amount_capturable: 0,
        amount_received: 0,
        currency: params.currency,
        client_secret: null,
        metadata: { ...params.metadata },
        last_payment_error: null,
      };
      intent.client_secret = `${intent.id}_secret_fake`;
      this.intents.set(intent.id, intent);
      this.byKey.set(options.idempotencyKey, intent.id);
      return { ...intent };
    },

    retrieve: async (id) => {
      this.reachable("retrieve");
      return { ...this.find(id) } satisfies StripePaymentIntentLike;
    },

    capture: async (id, params) => {
      this.reachable("capture");
      const intent = this.find(id);
      if (intent.status !== "requires_capture") throw unexpectedState(id, intent.status);
      if (params.amount_to_capture > intent.amount_capturable) {
        throw new FakeStripeError("The amount_to_capture is greater than the amount you can capture.", "StripeInvalidRequestError", "amount_too_large", 400);
      }
      intent.status = "succeeded";
      intent.amount_received = params.amount_to_capture;
      // The part that was not charged is let go by Stripe on its own.
      intent.amount_capturable = 0;
      return { ...intent };
    },

    cancel: async (id) => {
      this.reachable("cancel");
      const intent = this.find(id);
      if (intent.status === "canceled" || intent.status === "succeeded") throw unexpectedState(id, intent.status);
      intent.status = "canceled";
      intent.amount_capturable = 0;
      return { ...intent };
    },
  };

  /** What the browser does when a card is entered and confirmed: the amount is set aside. */
  confirmWithTestCard(id: string): void {
    const intent = this.find(id);
    if (intent.status !== "requires_payment_method") throw unexpectedState(id, intent.status);
    intent.status = "requires_capture";
    intent.amount_capturable = intent.amount;
    intent.last_payment_error = null;
  }

  /** What the browser does when the card is refused: the intent waits for another card. */
  declineCard(id: string, message = "Your card was declined."): void {
    const intent = this.find(id);
    intent.last_payment_error = { message, code: "card_declined" };
  }
}
