import type { EffectRetrier } from "@/domain/payments/effect-retrier";
import { isCronAuthorized } from "./cron-auth";

export interface RetryCronDeps {
  readonly secret: string | null;
  /** Null when this server does not take real card holds, so there is nothing to retry. */
  readonly retrier: Pick<EffectRetrier, "retry"> | null;
}

const json = (body: unknown, status: number): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The scheduled retry of money effects that failed: a hold that could not be released, a charge that could not be taken. */
export async function handleRetryEffects(request: Request, deps: RetryCronDeps): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"), deps.secret)) return json({ error: "unauthorized" }, 401);
  if (!deps.retrier) return json({ tried: 0, succeeded: 0, failed: 0, gaveUp: 0, skipped: "no_real_payments" }, 200);

  try {
    return json(await deps.retrier.retry(), 200);
  } catch {
    // A retry that cannot even start is for the logs, not for whoever called.
    console.error("retry-effects failed");
    return json({ error: "retry_failed" }, 500);
  }
}
