import { describe, expect, it } from "vitest";
import { describePaymentProviderContract } from "./contract";
import { MemoryPaymentProvider } from "./memory-provider";

describePaymentProviderContract("the in-memory provider", () => {
  const provider = new MemoryPaymentProvider();
  return { provider, completeCard: async (id) => provider.completeCard(id) };
});

describe("MemoryPaymentProvider, beyond the contract", () => {
  it("keeps the card's failure reason while the hold waits for another card, and clears it when a card works", async () => {
    const provider = new MemoryPaymentProvider();
    const created = await provider.createHold({ amountMinor: 1_000, currency: "USD", owner: { planId: "p", memberId: "m" }, idempotencyKey: "k" });
    if (!created.ok) throw new Error("expected a hold");
    provider.failCard(created.value.id, "Your card has insufficient funds.");
    expect(await provider.getHold(created.value.id)).toMatchObject({ ok: true, value: { status: "awaiting_card", lastError: "Your card has insufficient funds." } });
    provider.completeCard(created.value.id);
    expect(await provider.getHold(created.value.id)).toMatchObject({ ok: true, value: { status: "held", lastError: null } });
  });

  it("only hands out the secret for the card form while a card can still be added or is on the hold", async () => {
    const provider = new MemoryPaymentProvider();
    const created = await provider.createHold({ amountMinor: 1_000, currency: "USD", owner: { planId: "p", memberId: "m" }, idempotencyKey: "k" });
    if (!created.ok) throw new Error("expected a hold");
    await provider.release(created.value.id);
    expect(await provider.getHold(created.value.id)).toMatchObject({ ok: true, value: { clientSecret: null } });
  });

  it("can be made to fail like a provider that is down, call by call", async () => {
    const provider = new MemoryPaymentProvider();
    provider.outages.add("createHold");
    expect(await provider.createHold({ amountMinor: 1_000, currency: "USD", owner: { planId: "p", memberId: "m" }, idempotencyKey: "k" })).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(provider.calls).toEqual(["createHold"]);
  });
});
