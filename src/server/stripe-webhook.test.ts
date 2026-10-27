import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import type { HoldFailure } from "@/domain/payments/hold-service";
import { handleStripeWebhook, type StripeEventLike, type StripeWebhookDeps } from "./stripe-webhook";

const SECRET = "whsec_test_secret_for_unit_tests";
const stripe = new Stripe("sk_test_not_a_real_key");

const event = (type = "payment_intent.amount_capturable_updated", id: unknown = "pi_1"): StripeEventLike => ({ id: "evt_1", type, data: { object: { id } } });

/** A request signed the way Stripe signs them. */
function signed(payload: string, secret = SECRET): Request {
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": header }, body: payload });
}

function setup(overrides: Partial<StripeWebhookDeps> = {}) {
  const confirmed: [string, string][] = [];
  const deps: StripeWebhookDeps = {
    secret: SECRET,
    // The real check, from the SDK, so a bad signature really is refused.
    verify: (body, signature, secret) => stripe.webhooks.constructEvent(body, signature, secret) as unknown as StripeEventLike,
    store: { findByHoldId: async (id) => (id === "pi_1" ? ok({ planId: "plan-1", memberId: "ana" }) : err({ code: "not_found" as const, message: "no" })) },
    holds: { confirmHold: async (planId: string, memberId: string) => (confirmed.push([planId, memberId]), ok({ status: "placed" as const })) },
    ...overrides,
  };
  return { deps, confirmed };
}

afterEach(() => vi.restoreAllMocks());

describe("handleStripeWebhook", () => {
  it("confirms the hold named in a correctly signed event", async () => {
    const { deps, confirmed } = setup();
    const response = await handleStripeWebhook(signed(JSON.stringify(event())), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: true, outcome: "placed" });
    expect(confirmed).toEqual([["plan-1", "ana"]]);
  });

  it("refuses everything when no secret is configured, without reading it", async () => {
    const { deps, confirmed } = setup({ secret: null });
    const response = await handleStripeWebhook(signed(JSON.stringify(event())), deps);
    expect(response.status).toBe(503);
    expect(confirmed).toEqual([]);
  });

  it("refuses a request with no signature", async () => {
    const { deps, confirmed } = setup();
    const response = await handleStripeWebhook(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: JSON.stringify(event()) }), deps);
    expect(response.status).toBe(400);
    expect(confirmed).toEqual([]);
  });

  it("refuses an event signed with the wrong secret, and one whose body was changed after signing", async () => {
    const wrongSecret = setup();
    expect((await handleStripeWebhook(signed(JSON.stringify(event()), "whsec_someone_elses"), wrongSecret.deps)).status).toBe(400);

    const tampered = setup();
    const genuine = signed(JSON.stringify(event("payment_intent.amount_capturable_updated", "pi_1")));
    const forged = new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": genuine.headers.get("stripe-signature") as string }, body: JSON.stringify(event("payment_intent.amount_capturable_updated", "pi_other")) });
    expect((await handleStripeWebhook(forged, tampered.deps)).status).toBe(400);
    expect([...wrongSecret.confirmed, ...tampered.confirmed]).toEqual([]);
  });

  it("never says why a signature was refused", async () => {
    const response = await handleStripeWebhook(signed(JSON.stringify(event()), "whsec_wrong"), setup().deps);
    expect(await response.json()).toEqual({ error: "bad_signature" });
  });

  it("accepts and ignores events it has no use for", async () => {
    const { deps, confirmed } = setup();
    const response = await handleStripeWebhook(signed(JSON.stringify(event("charge.succeeded"))), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: false });
    expect(confirmed).toEqual([]);
  });

  it("accepts and ignores a hold that is not one of ours, so Stripe does not keep retrying it", async () => {
    const { deps, confirmed } = setup();
    const response = await handleStripeWebhook(signed(JSON.stringify(event("payment_intent.amount_capturable_updated", "pi_not_ours"))), deps);
    expect(response.status).toBe(200);
    expect(confirmed).toEqual([]);
  });

  it("ignores an event with no hold id in it", async () => {
    const { deps, confirmed } = setup();
    const response = await handleStripeWebhook(signed(JSON.stringify(event("payment_intent.amount_capturable_updated", 42))), deps);
    expect(response.status).toBe(200);
    expect(confirmed).toEqual([]);
  });

  it("asks Stripe to try again when the database or Stripe was unreachable, and not when retrying cannot help", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = (kind: HoldFailure["kind"]) => setup({ holds: { confirmHold: async () => err({ kind, message: "internal detail postgres://secret" }) } });
    for (const kind of ["payment", "store"] as const) {
      const response = await handleStripeWebhook(signed(JSON.stringify(event())), failing(kind).deps);
      expect(response.status, kind).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("secret");
    }
    for (const kind of ["mismatch", "not_applicable", "plan"] as const) {
      expect((await handleStripeWebhook(signed(JSON.stringify(event())), failing(kind).deps)).status, kind).toBe(200);
    }
  });

  it("asks Stripe to try again when the hold lookup itself fails", async () => {
    const { deps } = setup({ store: { findByHoldId: async () => err({ code: "unavailable" as const, message: "db" }) } });
    expect((await handleStripeWebhook(signed(JSON.stringify(event())), deps)).status).toBe(500);
  });
});
