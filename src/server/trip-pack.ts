import { buildCalendar, calendarFileName } from "@/lib/trip-pack";
import { loadPlanViewFor, type PlanViewDeps } from "./plan-view";

const text = (status: number): Response => new Response(status === 404 ? "Not found" : "Unavailable", { status, headers: { "Cache-Control": "no-store" } });

/**
 * The trip's calendar file, for a member of the group once the trip is booked. A plan that does not exist, one in another
 * group, one that is not booked yet and one with no dates all answer "not found", so this cannot be used to find out which
 * plans exist.
 */
export async function handleCalendar(deps: PlanViewDeps, groupId: string, planId: string, now: Date): Promise<Response> {
  const loaded = await loadPlanViewFor(deps, planId);
  if (!loaded.ok) return text(loaded.reason === "not_found" ? 404 : 503);
  const { view } = loaded;
  if (view.groupId !== groupId || (view.status !== "booked" && view.status !== "captured")) return text(404);

  const calendar = buildCalendar(view, now);
  if (calendar === null) return text(404);
  return new Response(calendar, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${calendarFileName(view.id)}"`,
      "Cache-Control": "no-store",
    },
  });
}
