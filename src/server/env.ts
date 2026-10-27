import { err, ok, type Result } from "@/lib/result";
import { museConfigFromEnv } from "@/infrastructure/muse/muse-config";
import type { PaymentsMode } from "@/domain/payments/types";
import type { MuseConfig } from "@/infrastructure/muse/muse-http";

export interface ServerEnv {
  readonly databaseUrl: string;
  readonly liteApiKey: string;
  readonly muse: MuseConfig;
  /** Without it no free-time ideas are checked, and plans have none. */
  readonly placesApiKey: string | null;
  /** Without it the cron route refuses every call. */
  readonly cronSecret: string | null;
  /** Asked for with SIMULATE_HOLDS=1. Whether it is allowed is decided by `resolveHoldSimulation`. */
  readonly simulateHolds: boolean;
  /** Asked for with SIMULATE_BOOKING=1. Whether it is allowed is decided by `resolveBookingSimulation`. */
  readonly simulateBooking: boolean;
  /** Without it no real card holds are made. */
  readonly stripeSecretKey: string | null;
  /** Without it Stripe's webhook calls are all refused. */
  readonly stripeWebhookSecret: string | null;
}

export interface EnvError {
  /** Names only, never values. */
  readonly missing: readonly string[];
}

const REQUIRED = ["DATABASE_URL", "LITEAPI_KEY", "MUSE_SPARK_API_KEY"] as const;

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Reads what the server needs from the environment. Says which names are missing, never what the values are. */
export function readServerEnv(env: Readonly<Record<string, string | undefined>>): Result<ServerEnv, EnvError> {
  const missing = REQUIRED.filter((name) => clean(env[name]) === null);
  const muse = museConfigFromEnv(env);
  const databaseUrl = clean(env.DATABASE_URL);
  const liteApiKey = clean(env.LITEAPI_KEY);
  if (missing.length > 0 || !muse.ok || !databaseUrl || !liteApiKey) return err({ missing });
  return ok({ databaseUrl, liteApiKey, muse: muse.value, placesApiKey: clean(env.GOOGLE_PLACES_API_KEY), cronSecret: clean(env.CRON_SECRET), simulateHolds: clean(env.SIMULATE_HOLDS) === "1", simulateBooking: clean(env.SIMULATE_BOOKING) === "1", stripeSecretKey: clean(env.STRIPE_SECRET_KEY), stripeWebhookSecret: clean(env.STRIPE_WEBHOOK_SECRET) });
}

/**
 * Pretending a card hold is placed is for trying the screens out before payments are connected. In production it
 * would let people "pay" without paying, so asking for it there stops the server instead of quietly allowing it.
 */
export function resolveHoldSimulation(requested: boolean, nodeEnv: string | undefined): Result<boolean, { readonly message: string }> {
  if (requested && nodeEnv === "production") return err({ message: "SIMULATE_HOLDS must not be set in production" });
  return ok(requested);
}

/**
 * How money is handled. A pretended hold wins when asked for, because it is asked for on purpose; otherwise real
 * Stripe holds when there is a key for them, otherwise nothing can be held.
 */
export function resolvePaymentsMode(input: { readonly simulateHolds: boolean; readonly stripeSecretKey: string | null }): PaymentsMode {
  if (input.simulateHolds) return "demo";
  return input.stripeSecretKey ? "stripe" : "none";
}

/**
 * Pretending a booking succeeded is for trying the money path out before real booking exists. In production it
 * would charge people for a trip that was never booked, so asking for it there stops the server.
 */
export function resolveBookingSimulation(requested: boolean, nodeEnv: string | undefined): Result<boolean, { readonly message: string }> {
  if (requested && nodeEnv === "production") return err({ message: "SIMULATE_BOOKING must not be set in production" });
  return ok(requested);
}
