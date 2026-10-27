import { err, ok, type Result } from "@/lib/result";
import type { MuseConfig } from "./muse-http";

export interface MuseConfigError {
  readonly code: "not_configured";
  readonly message: string;
}

/** Reads the Muse settings from the environment. Only the key is required; the model and address have defaults. */
export function museConfigFromEnv(env: Readonly<Record<string, string | undefined>>): Result<MuseConfig, MuseConfigError> {
  const apiKey = env.MUSE_SPARK_API_KEY?.trim();
  if (!apiKey) return err({ code: "not_configured", message: "MUSE_SPARK_API_KEY is not set" });
  return ok({
    apiKey,
    ...(env.MUSE_MODEL?.trim() && { model: env.MUSE_MODEL.trim() }),
    ...(env.MUSE_BASE_URL?.trim() && { baseUrl: env.MUSE_BASE_URL.trim() }),
  });
}
