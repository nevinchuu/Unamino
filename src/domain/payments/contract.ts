import { describe, expect, it } from "vitest";
import type { PaymentProvider, HoldRequest } from "./types";

/** A provider to test, and the one thing a browser does that the provider cannot do for itself. */
export interface ProviderUnderTest {
  readonly provider: PaymentProvider;
  /** Enters and confirms a card for this hold, as the person's browser would, so the amount is set aside. */
  readonly completeCard: (holdId: string) => Promise<void>;
}

let counter = 0;
const request = (overrides: Partial<HoldRequest> = {}): HoldRequest => {
  counter += 1;
  return { amountMinor: 30_000, currency: "USD", owner: { planId: "plan-1", memberId: "ana" }, idempotencyKey: `contract-${Date.now().toString(36)}-${counter}`, ...overrides };
};

/**
 * What every payment provider must do. The same tests run against the in-memory provider, against the Stripe
 * provider on a fake Stripe, and (when asked for) against Stripe's real test mode, which is how the rules here
 * were found to be true in the first place.
 */
export function describePaymentProviderContract(name: string, make: () => Promise<ProviderUnderTest> | ProviderUnderTest, options: { readonly timeoutMs?: number } = {}): void {
  const timeout = options.timeoutMs ?? 10_000;
  const heldHold = async (amountMinor = 30_000) => {
    const sut = await make();
    const created = await sut.provider.createHold(request({ amountMinor }));
    if (!created.ok) throw new Error(`could not create a hold: ${created.error.message}`);
    await sut.completeCard(created.value.id);
    return { ...sut, id: created.value.id };
  };

  describe(`${name}: the payment provider contract`, () => {
    it("creates a hold that waits for a card, for the amount and owner asked for, and sets nothing aside yet", async () => {
      const { provider } = await make();
      const created = await provider.createHold(request({ amountMinor: 29_009, currency: "USD", owner: { planId: "plan-7", memberId: "ben" } }));
      expect(created).toMatchObject({ ok: true, value: { status: "awaiting_card", amountMinor: 29_009, heldMinor: 0, chargedMinor: 0, currency: "USD", owner: { planId: "plan-7", memberId: "ben" } } });
      expect(created.ok && created.value.clientSecret).toEqual(expect.any(String));
    }, timeout);

    it("gives the same hold for the same key and a different hold for a different key", async () => {
      const { provider } = await make();
      const once = request();
      const [first, again] = [await provider.createHold(once), await provider.createHold(once)];
      const other = await provider.createHold(request());
      if (!first.ok || !again.ok || !other.ok) throw new Error("holds should have been created");
      expect(again.value.id).toBe(first.value.id);
      expect(other.value.id).not.toBe(first.value.id);
    }, timeout);

    it("refuses a hold that makes no sense, without creating anything", async () => {
      const { provider } = await make();
      for (const amountMinor of [0, -5, 1.5]) expect(await provider.createHold(request({ amountMinor }))).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    }, timeout);

    it("shows the amount as set aside once the card is confirmed, and keeps the owner", async () => {
      const { provider, id } = await heldHold(30_000);
      expect(await provider.getHold(id)).toMatchObject({ ok: true, value: { status: "held", amountMinor: 30_000, heldMinor: 30_000, chargedMinor: 0, owner: { planId: "plan-1", memberId: "ana" } } });
    }, timeout);

    it("charges part of a hold and lets go of the rest", async () => {
      const { provider, id } = await heldHold(30_000);
      expect(await provider.capture(id, 25_000, `capture-${id}`)).toMatchObject({ ok: true, value: { status: "captured", chargedMinor: 25_000, heldMinor: 0 } });
      expect(await provider.getHold(id)).toMatchObject({ ok: true, value: { status: "captured", chargedMinor: 25_000, heldMinor: 0 } });
    }, timeout);

    it("refuses to charge more than is held, and leaves the hold as it was", async () => {
      const { provider, id } = await heldHold(30_000);
      expect(await provider.capture(id, 40_000, `too-much-${id}`)).toMatchObject({ ok: false, error: { code: "amount_too_large" } });
      expect(await provider.getHold(id)).toMatchObject({ ok: true, value: { status: "held", heldMinor: 30_000, chargedMinor: 0 } });
    }, timeout);

    it("charges the whole hold when asked for the whole amount", async () => {
      const { provider, id } = await heldHold(12_345);
      expect(await provider.capture(id, 12_345, `all-${id}`)).toMatchObject({ ok: true, value: { status: "captured", chargedMinor: 12_345 } });
    }, timeout);

    it("treats the same capture arriving twice as one capture, and refuses a different amount afterwards", async () => {
      const { provider, id } = await heldHold(30_000);
      await provider.capture(id, 25_000, `first-${id}`);
      expect(await provider.capture(id, 25_000, `second-${id}`)).toMatchObject({ ok: true, value: { status: "captured", chargedMinor: 25_000 } });
      expect(await provider.capture(id, 20_000, `third-${id}`)).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    }, timeout);

    it("cannot charge a hold that has no card on it yet", async () => {
      const { provider } = await make();
      const created = await provider.createHold(request());
      if (!created.ok) throw new Error("hold should have been created");
      expect(await provider.capture(created.value.id, 1_000, `early-${created.value.id}`)).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    }, timeout);

    it("lets go of a hold without charging, and releasing again is not an error", async () => {
      const { provider, id } = await heldHold(30_000);
      expect(await provider.release(id, `release-${id}`)).toMatchObject({ ok: true, value: { status: "released", heldMinor: 0, chargedMinor: 0 } });
      expect(await provider.release(id, `release-again-${id}`)).toMatchObject({ ok: true, value: { status: "released" } });
    }, timeout);

    it("can let go of a hold that never got a card", async () => {
      const { provider } = await make();
      const created = await provider.createHold(request());
      if (!created.ok) throw new Error("hold should have been created");
      expect(await provider.release(created.value.id, `abandon-${created.value.id}`)).toMatchObject({ ok: true, value: { status: "released" } });
    }, timeout);

    it("cannot release what was already charged, or charge what was released", async () => {
      const charged = await heldHold(30_000);
      await charged.provider.capture(charged.id, 30_000, `c-${charged.id}`);
      expect(await charged.provider.release(charged.id, `r-${charged.id}`)).toMatchObject({ ok: false, error: { code: "invalid_state" } });

      const released = await heldHold(30_000);
      await released.provider.release(released.id, `r-${released.id}`);
      expect(await released.provider.capture(released.id, 1_000, `c-${released.id}`)).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    }, timeout);

    it("says so for a hold that does not exist", async () => {
      const { provider } = await make();
      expect(await provider.getHold("hold_that_does_not_exist")).toMatchObject({ ok: false, error: { code: "not_found" } });
    }, timeout);
  });
}
