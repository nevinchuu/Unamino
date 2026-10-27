import { err, ok, type Result } from "@/lib/result";
import { museConfigFromEnv } from "@/infrastructure/muse/muse-config";
import type { MuseConfig } from "@/infrastructure/muse/muse-http";

export interface ServerEnv {
  readonly databaseUrl: string;
  readonly liteApiKey: string;
  readonly muse: MuseConfig;
  /** Without it no free-time ideas are checked, and plans have none. */
  readonly placesApiKey: string | null;
  /** Without it the cron route refuses every call. */
  readonly cronSecret: string | null;
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
  return ok({ databaseUrl, liteApiKey, muse: muse.value, placesApiKey: clean(env.GOOGLE_PLACES_API_KEY), cronSecret: clean(env.CRON_SECRET) });
}
