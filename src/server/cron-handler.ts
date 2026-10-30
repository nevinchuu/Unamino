import type { BookingSweeper } from "@/domain/booking/sweeper";
import type { PlanService } from "@/domain/plan/service";
import type { RetentionService } from "@/domain/retention/retention-service";
import type { TravellerService } from "@/domain/travellers/service";
import { isCronAuthorized } from "./cron-auth";

/** How many overdue plans one run looks at. The next run picks up the rest. */
export const OVERDUE_BATCH = 50;
/** How many old groups one run deletes. The next run picks up the rest. */
export const RETENTION_BATCH = 25;

export interface CronDeps {
  readonly secret: string | null;
  readonly service: Pick<PlanService, "expireOverdue">;
  /** Null when this server does not book for real, so no booking can be stuck. */
  readonly bookings?: Pick<BookingSweeper, "sweep"> | null;
  /** Null when this server does not take traveller details. */
  readonly travellers?: Pick<TravellerService, "purgeStale"> | null;
  /** Deletes groups and dispute records that have outlived their retention. Null where the sweep should not do that. */
  readonly retention?: Pick<RetentionService, "sweep"> | null;
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
  // Details kept past any plan's life are deleted here whatever else the sweep found, so they never wait on a plan being swept.
  const purged = deps.travellers ? await deps.travellers.purgeStale(deps.now()) : null;
  // Personal data past its retention is deleted last, so a slow sweep never holds up ending plans and releasing holds.
  const retained = deps.retention ? await deps.retention.sweep(deps.now(), RETENTION_BATCH) : null;
  if (retained && !retained.ok) console.error("retention sweep failed");
  return json({ ...swept.value, ...(booking && { booking }), ...(purged?.ok && { travellersPurged: purged.value }), ...(retained?.ok && { retention: retained.value }) }, 200);
}
