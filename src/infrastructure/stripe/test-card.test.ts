import { describe, expect, it } from "vitest";
import { StripeTestCard, type StripeConfirmLike } from "./test-card";

const fake = (status = "requires_capture") => {
  const calls: { id: string; payment_method: string }[] = [];
  const client: StripeConfirmLike = { paymentIntents: { confirm: async (id, params) => (calls.push({ id, ...params }), { status }) } };
  return { client, calls };
};

describe("StripeTestCard", () => {
  it("does not exist for a live key, or for anything that is not a test key", () => {
    const { client } = fake();
    expect(StripeTestCard.forKey("sk_live_abc", client)).toBeNull();
    expect(StripeTestCard.forKey("rk_test_abc", client)).toBeNull();
    expect(StripeTestCard.forKey("", client)).toBeNull();
  });

  it("confirms the hold with the published test card, found from the secret", async () => {
    const { client, calls } = fake();
    const card = StripeTestCard.forKey("sk_test_abc", client);
    expect(await card?.place("pi_3Abc123_secret_xyz789")).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([{ id: "pi_3Abc123", payment_method: "pm_card_visa" }]);
  });

  it("refuses a secret that is not a hold's, without calling Stripe", async () => {
    const { client, calls } = fake();
    expect(await StripeTestCard.forKey("sk_test_abc", client)?.place("seti_123_secret_x")).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("reports a card that did not go through, and a Stripe that cannot be reached", async () => {
    expect(await StripeTestCard.forKey("sk_test_abc", fake("requires_payment_method").client)?.place("pi_1_secret_x")).toMatchObject({ ok: false, error: expect.stringContaining("requires_payment_method") });
    const down: StripeConfirmLike = { paymentIntents: { confirm: async () => Promise.reject(new Error("sk_test_leak")) } };
    const result = await StripeTestCard.forKey("sk_test_abc", down)?.place("pi_1_secret_x");
    expect(result).toEqual({ ok: false, error: "Stripe could not be reached." });
  });
});
