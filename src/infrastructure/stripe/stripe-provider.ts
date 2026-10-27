import { err, ok, type Result } from "@/lib/result";
import type { Hold, HoldRequest, HoldStatus, PaymentError, PaymentErrorCode, PaymentProvider } from "@/domain/payments/types";

/** The parts of a Stripe PaymentIntent this code reads. The real SDK's type has many more fields. */
export interface StripePaymentIntentLike {
  readonly id: string;
  readonly status: string;
  readonly amount: number;
  readonly amount_capturable: number;
  readonly amount_received: number;
  readonly currency: string;
  readonly client_secret: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly last_payment_error?: { readonly message?: string; readonly code?: string } | null;
}

interface RequestOptions {
  readonly idempotencyKey: string;
}

/** The parts of the Stripe SDK this code calls, so a fake can stand in for it in tests. */
export interface StripeClientLike {
  readonly paymentIntents: {
    create(
      params: { amount: number; currency: string; capture_method: "manual"; automatic_payment_methods: { enabled: true; allow_redirects: "never" }; metadata: Record<string, string>; description: string },
      options: RequestOptions,
    ): Promise<StripePaymentIntentLike>;
    retrieve(id: string): Promise<StripePaymentIntentLike>;
    capture(id: string, params: { amount_to_capture: number }, options: RequestOptions): Promise<StripePaymentIntentLike>;
    cancel(id: string, params: { cancellation_reason: "requested_by_customer" }, options: RequestOptions): Promise<StripePaymentIntentLike>;
  };
}

const DESCRIPTION = "Unamino trip hold";

const STATUS_OF: Readonly<Record<string, HoldStatus>> = {
  requires_capture: "held",
  succeeded: "captured",
  canceled: "released",
};

/** A key must never reach a log, even a partly hidden one in an error message. */
const redact = (text: string): string => text.replace(/(sk|rk|pk|whsec)_(test|live)?_?[A-Za-z0-9*]+/g, "[key]");

/** A hold the way the rest of the app sees it. Only ids go to Stripe in the metadata, so only ids come back. */
export function holdFrom(intent: StripePaymentIntentLike): Hold {
  const status = STATUS_OF[intent.status] ?? "awaiting_card";
  return {
    id: intent.id,
    status,
    amountMinor: intent.amount,
    heldMinor: status === "held" ? intent.amount_capturable : 0,
    chargedMinor: intent.amount_received,
    currency: intent.currency.toUpperCase(),
    owner: { planId: intent.metadata.planId ?? "", memberId: intent.metadata.memberId ?? "" },
    clientSecret: status === "awaiting_card" || status === "held" ? intent.client_secret : null,
    lastError: intent.last_payment_error?.message ?? intent.last_payment_error?.code ?? null,
  };
}

interface StripeErrorLike {
  readonly type?: unknown;
  readonly code?: unknown;
  readonly statusCode?: unknown;
  readonly message?: unknown;
}

/** What went wrong, in this app's terms. Anything that is not a Stripe error is a failure to reach Stripe. */
export function paymentErrorFrom(error: unknown): PaymentError {
  const e = (typeof error === "object" && error !== null ? error : {}) as StripeErrorLike;
  const message = redact(typeof e.message === "string" ? e.message : "Stripe could not be reached");
  const fail = (code: PaymentErrorCode): PaymentError => ({ code, message });

  if (typeof e.type !== "string") return fail("unavailable");
  if (e.code === "resource_missing") return fail("not_found");
  if (e.code === "amount_too_large") return fail("amount_too_large");
  if (e.code === "payment_intent_unexpected_state") return fail("invalid_state");
  if (e.type === "StripeCardError") return fail("declined");
  // A wrong key or a busy or broken Stripe is nothing the person did and nothing retrying the same request fixes right away.
  if (e.type === "StripeAuthenticationError" || e.type === "StripePermissionError" || e.type === "StripeConnectionError" || e.type === "StripeRateLimitError") return fail("unavailable");
  if (e.type === "StripeAPIError" || (typeof e.statusCode === "number" && e.statusCode >= 500)) return fail("unavailable");
  return fail("invalid_request");
}

/**
 * Card holds on Stripe: a PaymentIntent that is authorised now and charged later (`capture_method: "manual"`),
 * for part or all of what was held. The card is entered in Stripe's own form in the browser, so card numbers
 * never reach this server. Every call that changes something carries an idempotency key.
 */
export class StripePaymentProvider implements PaymentProvider {
  constructor(private readonly client: StripeClientLike) {}

  async createHold(request: HoldRequest): Promise<Result<Hold, PaymentError>> {
    try {
      const intent = await this.client.paymentIntents.create(
        {
          amount: request.amountMinor,
          currency: request.currency.toLowerCase(),
          capture_method: "manual",
          // Stripe now picks the payment methods from the dashboard's settings. Methods that send the person away to pay
          // elsewhere are left out, because a hold can only be set aside and charged later on a card that is entered here.
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: { planId: request.owner.planId, memberId: request.owner.memberId },
          description: DESCRIPTION,
        },
        { idempotencyKey: request.idempotencyKey },
      );
      return ok(holdFrom(intent));
    } catch (error) {
      return err(paymentErrorFrom(error));
    }
  }

  async getHold(holdId: string): Promise<Result<Hold, PaymentError>> {
    try {
      return ok(holdFrom(await this.client.paymentIntents.retrieve(holdId)));
    } catch (error) {
      return err(paymentErrorFrom(error));
    }
  }

  async capture(holdId: string, amountMinor: number, idempotencyKey: string): Promise<Result<Hold, PaymentError>> {
    try {
      return ok(holdFrom(await this.client.paymentIntents.capture(holdId, { amount_to_capture: amountMinor }, { idempotencyKey })));
    } catch (error) {
      const failure = paymentErrorFrom(error);
      if (failure.code !== "invalid_state") return err(failure);
      // The same capture arriving twice is not a mistake: if it already went through for this amount, say so.
      const current = await this.getHold(holdId);
      return current.ok && current.value.status === "captured" && current.value.chargedMinor === amountMinor ? current : err(failure);
    }
  }

  async release(holdId: string, idempotencyKey: string): Promise<Result<Hold, PaymentError>> {
    try {
      return ok(holdFrom(await this.client.paymentIntents.cancel(holdId, { cancellation_reason: "requested_by_customer" }, { idempotencyKey })));
    } catch (error) {
      const failure = paymentErrorFrom(error);
      if (failure.code !== "invalid_state") return err(failure);
      // Letting go of what is already let go is done, not failed.
      const current = await this.getHold(holdId);
      return current.ok && current.value.status === "released" ? current : err(failure);
    }
  }
}
