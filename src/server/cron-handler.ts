import type { BookingSweeper } from "@/domain/booking/sweeper";
import type { PlanService } from "@/domain/plan/service";
import { isCronAuthorized } from "./cron-auth";

/** How many overdue plans one run looks at. The next run picks up the rest. */
export const OVERDUE_BATCH = 50;

export interface CronDeps {
  readonly secret: string | null;
  readonly service: Pick<PlanService, "expireOverdue">;
  /** Null when this server does not book for real, so no booking can be stuck. */
  readonly bookings?: Pick<BookingSweeper, "sweep"> | null;
  readonly now: () => Date;
}

const json = (body: unknown, status: number): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The scheduled sweep: ends plans past their cap, renews or ends the ones past their deadline, and settles bookings that got stuck. */
export async function handleExpireOverdue(request: Request, deps: CronDeps): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"), deps.secret)) return json({ error: "unauthorized" }, 401);

  const swept = await deps.service.expireOverdue(deps.now(), OVERDUE_BATCH);
  if (!swept.ok) {
    // The kind names what failed; the message may carry details that belong in logs only.
    console.error("expire-overdue failed", swept.error.kind);
    return json({ error: "sweep_failed" }, 500);
  }
  const booking = deps.bookings ? await deps.bookings.sweep(OVERDUE_BATCH) : null;
  return json(booking ? { ...swept.value, booking } : swept.value, 200);
}
