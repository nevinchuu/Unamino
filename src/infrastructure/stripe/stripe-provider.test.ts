import { describe, expect, it } from "vitest";
import { describePaymentProviderContract } from "@/domain/payments/contract";
import { FakeStripeClient, FakeStripeError } from "./fake-stripe-client";
import { holdFrom, paymentErrorFrom, StripePaymentProvider, type StripeClientLike, type StripePaymentIntentLike } from "./stripe-provider";

describePaymentProviderContract("the Stripe provider on a fake Stripe", () => {
  const client = new FakeStripeClient();
  return { provider: new StripePaymentProvider(client), completeCard: async (id) => client.confirmWithTestCard(id) };
});

const intent = (overrides: Partial<StripePaymentIntentLike> = {}): StripePaymentIntentLike => ({
  id: "pi_1", status: "requires_payment_method", amount: 29_009, amount_capturable: 0, amount_received: 0, currency: "usd", client_secret: "pi_1_secret_x", metadata: { planId: "plan-1", memberId: "ana" }, last_payment_error: null, ...overrides,
});

describe("holdFrom", () => {
  it.each([
    ["requires_payment_method", "awaiting_card"],
    ["requires_confirmation", "awaiting_card"],
    ["requires_action", "awaiting_card"],
    ["processing", "awaiting_card"],
    ["requires_capture", "held"],
    ["succeeded", "captured"],
    ["canceled", "released"],
    ["something_new_stripe_added", "awaiting_card"],
  ])("reads a Stripe status of %s as %s", (status, expected) => {
    expect(holdFrom(intent({ status })).status).toBe(expected);
  });

  it("sets aside only what Stripe says can be charged, and only while held", () => {
    expect(holdFrom(intent({ status: "requires_capture", amount_capturable: 29_009 })).heldMinor).toBe(29_009);
    expect(holdFrom(intent({ status: "requires_payment_method", amount_capturable: 29_009 })).heldMinor).toBe(0);
    expect(holdFrom(intent({ status: "succeeded", amount_capturable: 4_000, amount_received: 25_009 }))).toMatchObject({ heldMinor: 0, chargedMinor: 25_009 });
  });

  it("writes the currency in capitals and keeps who the hold is for", () => {
    expect(holdFrom(intent())).toMatchObject({ currency: "USD", owner: { planId: "plan-1", memberId: "ana" } });
    expect(holdFrom(intent({ metadata: {} })).owner).toEqual({ planId: "", memberId: "" });
  });

  it("gives out the card form's secret only while a card can still be added or is on the hold", () => {
    expect(holdFrom(intent()).clientSecret).toBe("pi_1_secret_x");
    expect(holdFrom(intent({ status: "requires_capture" })).clientSecret).toBe("pi_1_secret_x");
    expect(holdFrom(intent({ status: "succeeded" })).clientSecret).toBeNull();
    expect(holdFrom(intent({ status: "canceled" })).clientSecret).toBeNull();
  });

  it("keeps the reason a card was refused, for the logs", () => {
    expect(holdFrom(intent({ last_payment_error: { message: "Your card was declined." } })).lastError).toBe("Your card was declined.");
    expect(holdFrom(intent({ last_payment_error: { code: "card_declined" } })).lastError).toBe("card_declined");
    expect(holdFrom(intent()).lastError).toBeNull();
  });
});

describe("paymentErrorFrom", () => {
  const stripe = (type: string, code?: string, statusCode = 400) => new FakeStripeError("boom", type, code, statusCode);

  it.each([
    [stripe("StripeInvalidRequestError", "resource_missing", 404), "not_found"],
    [stripe("StripeInvalidRequestError", "amount_too_large"), "amount_too_large"],
    [stripe("StripeInvalidRequestError", "payment_intent_unexpected_state"), "invalid_state"],
    [stripe("StripeCardError", "card_declined", 402), "declined"],
    [stripe("StripeAuthenticationError", undefined, 401), "unavailable"],
    [stripe("StripePermissionError", undefined, 403), "unavailable"],
    [stripe("StripeConnectionError"), "unavailable"],
    [stripe("StripeRateLimitError", undefined, 429), "unavailable"],
    [stripe("StripeAPIError", undefined, 500), "unavailable"],
    [stripe("SomethingElse", undefined, 503), "unavailable"],
    [stripe("StripeInvalidRequestError", "parameter_invalid_integer"), "invalid_request"],
  ])("reads %j as %s", (error, expected) => {
    expect(paymentErrorFrom(error).code).toBe(expected);
  });

  it("treats anything that is not a Stripe error, such as a dropped connection, as Stripe being unreachable", () => {
    expect(paymentErrorFrom(new Error("connect ECONNREFUSED")).code).toBe("unavailable");
    expect(paymentErrorFrom("a string")).toMatchObject({ code: "unavailable" });
    expect(paymentErrorFrom(undefined).code).toBe("unavailable");
  });

  it("never lets a key into the message that is logged", () => {
    const message = paymentErrorFrom(new FakeStripeError("Invalid API Key provided: sk_test_51Abc***xyz and rk_live_abc123 and whsec_abc123", "StripeAuthenticationError", undefined, 401)).message;
    expect(message).not.toMatch(/sk_test|rk_live|whsec_abc|51Abc/);
    expect(message).toContain("[key]");
  });
});

describe("StripePaymentProvider, what it asks of Stripe", () => {
  /** A client that records the parameters of every call and answers like a fresh hold. */
  function recording() {
    const seen: { call: string; params: unknown; options: unknown }[] = [];
    const client: StripeClientLike = {
      paymentIntents: {
        create: async (params, options) => (seen.push({ call: "create", params, options }), intent()),
        retrieve: async (id) => (seen.push({ call: "retrieve", params: id, options: undefined }), intent({ status: "requires_capture", amount_capturable: 29_009 })),
        capture: async (id, params, options) => (seen.push({ call: "capture", params: { id, ...params }, options }), intent({ status: "succeeded", amount_received: params.amount_to_capture })),
        cancel: async (id, params, options) => (seen.push({ call: "cancel", params: { id, ...params }, options }), intent({ status: "canceled" })),
      },
    };
    return { provider: new StripePaymentProvider(client), seen };
  }

  it("creates a hold that is charged later, without redirects, carrying only ids and no names", async () => {
    const { provider, seen } = recording();
    await provider.createHold({ amountMinor: 29_009, currency: "USD", owner: { planId: "plan-1", memberId: "ana" }, idempotencyKey: "hold:plan-1:ana:3" });
    expect(seen).toEqual([
      {
        call: "create",
        params: { amount: 29_009, currency: "usd", capture_method: "manual", automatic_payment_methods: { enabled: true, allow_redirects: "never" }, metadata: { planId: "plan-1", memberId: "ana" }, description: "Unamino trip hold" },
        options: { idempotencyKey: "hold:plan-1:ana:3" },
      },
    ]);
  });

  it("asks to charge exactly the amount given, with the key it was given", async () => {
    const { provider, seen } = recording();
    await provider.capture("pi_1", 25_000, "capture:pi_1");
    expect(seen).toEqual([{ call: "capture", params: { id: "pi_1", amount_to_capture: 25_000 }, options: { idempotencyKey: "capture:pi_1" } }]);
  });

  it("releases for the customer's sake and with the key it was given", async () => {
    const { provider, seen } = recording();
    await provider.release("pi_1", "release:pi_1");
    expect(seen).toEqual([{ call: "cancel", params: { id: "pi_1", cancellation_reason: "requested_by_customer" }, options: { idempotencyKey: "release:pi_1" } }]);
  });

  it("looks a hold up again only to check a repeated capture or release, and not after any other kind of failure", async () => {
    const client = new FakeStripeClient();
    const provider = new StripePaymentProvider(client);
    const created = await provider.createHold({ amountMinor: 1_000, currency: "USD", owner: { planId: "p", memberId: "m" }, idempotencyKey: "k" });
    if (!created.ok) throw new Error("expected a hold");
    client.confirmWithTestCard(created.value.id);

    client.calls.length = 0;
    await provider.capture(created.value.id, 5_000, "k2");
    expect(client.calls).toEqual(["capture"]);
  });
});

describe("StripePaymentProvider when Stripe cannot be reached", () => {
  it("says so for every call, and never throws", async () => {
    const client = new FakeStripeClient();
    const provider = new StripePaymentProvider(client);
    const created = await provider.createHold({ amountMinor: 1_000, currency: "USD", owner: { planId: "p", memberId: "m" }, idempotencyKey: "k" });
    if (!created.ok) throw new Error("expected a hold");

    client.down = true;
    const results = [
      await provider.createHold({ amountMinor: 1_000, currency: "USD", owner: { planId: "p", memberId: "m" }, idempotencyKey: "k2" }),
      await provider.getHold(created.value.id),
      await provider.capture(created.value.id, 1_000, "c"),
      await provider.release(created.value.id, "r"),
    ];
    expect(results.map((r) => (r.ok ? "ok" : r.error.code))).toEqual(["unavailable", "unavailable", "unavailable", "unavailable"]);
  });
});
