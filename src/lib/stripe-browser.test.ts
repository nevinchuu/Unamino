import { describe, expect, it } from "vitest";
import { isTestKey, outcomeOfCardEntry, TEST_CARD_HINT } from "./stripe-browser";

describe("outcomeOfCardEntry", () => {
  it("asks the server to confirm once the card is on the hold", () => {
    expect(outcomeOfCardEntry({ paymentIntent: { status: "requires_capture" } })).toEqual({ kind: "confirm" });
  });

  it("shows Stripe's own message when the card is refused, and a plain one when it gives none", () => {
    expect(outcomeOfCardEntry({ error: { message: "Your card was declined." } })).toEqual({ kind: "error", message: "Your card was declined." });
    expect(outcomeOfCardEntry({ error: {} })).toEqual({ kind: "error", message: "The card wasn't accepted. Try another card." });
    expect(outcomeOfCardEntry({ error: { message: "   " } })).toEqual({ kind: "error", message: "The card wasn't accepted. Try another card." });
  });

  it("treats an error as an error even when a payment is also reported", () => {
    expect(outcomeOfCardEntry({ error: { message: "No." }, paymentIntent: { status: "requires_capture" } })).toMatchObject({ kind: "error" });
  });

  it("waits while the bank is still checking", () => {
    expect(outcomeOfCardEntry({ paymentIntent: { status: "processing" } })).toEqual({ kind: "processing" });
  });

  it.each(["requires_payment_method", "requires_action", "succeeded", "canceled", "something_new"])("does not take a status of %s for a placed hold", (status) => {
    expect(outcomeOfCardEntry({ paymentIntent: { status } })).toEqual({ kind: "unexpected" });
  });

  it("copes with a result that says nothing", () => {
    expect(outcomeOfCardEntry({})).toEqual({ kind: "unexpected" });
  });
});

describe("isTestKey", () => {
  it("knows a test-mode publishable key from a live one", () => {
    expect(isTestKey("pk_test_abc")).toBe(true);
    expect(isTestKey("pk_live_abc")).toBe(false);
    expect(isTestKey("")).toBe(false);
  });

  it("has a hint that names Stripe's published test card", () => {
    expect(TEST_CARD_HINT).toContain("4242 4242 4242 4242");
  });
});
