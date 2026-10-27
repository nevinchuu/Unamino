import Stripe from "stripe";
import { StripePaymentProvider, type StripeClientLike } from "./stripe-provider";

/** A flaky connection is retried a couple of times. That is safe because every call that changes something carries an idempotency key. */
const NETWORK_RETRIES = 2;

/** The real Stripe SDK, typed as the part of it this app uses. */
export function createStripeClient(secretKey: string): StripeClientLike & Stripe {
  return new Stripe(secretKey, { maxNetworkRetries: NETWORK_RETRIES, appInfo: { name: "Unamino" } });
}

export const createStripePaymentProvider = (secretKey: string): StripePaymentProvider => new StripePaymentProvider(createStripeClient(secretKey));
