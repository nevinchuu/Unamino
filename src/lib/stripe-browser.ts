import { loadStripe, type Stripe } from "@stripe/stripe-js";

let loading: Promise<Stripe | null> | null = null;

/** Stripe.js, loaded once for the page. It is Stripe's own script, which is what keeps card numbers off this server. */
export const getStripe = (publishableKey: string): Promise<Stripe | null> => (loading ??= loadStripe(publishableKey));

/** A test-mode key, which only ever deals in Stripe's test cards. */
export const isTestKey = (publishableKey: string): boolean => publishableKey.startsWith("pk_test_");

export const TEST_CARD_HINT = "Test mode: use card 4242 4242 4242 4242, any future date and any 3-digit code.";

/** What came back from Stripe's card form. Only the parts this reads. */
export interface CardEntryResult {
  readonly error?: { readonly message?: string } | undefined;
  readonly paymentIntent?: { readonly status: string } | undefined;
}

export type CardEntryOutcome =
  /** The card was refused or could not be read. The message is Stripe's own, written for the person. */
  | { readonly kind: "error"; readonly message: string }
  /** The card is on the hold. The server still asks Stripe before it believes that. */
  | { readonly kind: "confirm" }
  /** The bank is still checking. */
  | { readonly kind: "processing" }
  | { readonly kind: "unexpected" };

/** What to do after the card form says it is done. */
export function outcomeOfCardEntry(result: CardEntryResult): CardEntryOutcome {
  if (result.error) return { kind: "error", message: result.error.message?.trim() || "The card wasn't accepted. Try another card." };
  switch (result.paymentIntent?.status) {
    case "requires_capture":
      return { kind: "confirm" };
    case "processing":
      return { kind: "processing" };
    default:
      return { kind: "unexpected" };
  }
}
