import { getContainer } from "@/server/container";
import { handleCalendar } from "@/server/trip-pack";
import { currentMember } from "@/server/session";

/** The trip's calendar file. Only a member of the group can have it, and only once the trip is booked. */
export async function GET(_request: Request, context: RouteContext<"/g/[groupId]/plan/[planId]/pack/calendar">): Promise<Response> {
  const { groupId, planId } = await context.params;
  const { views, payments } = getContainer();
  return handleCalendar(
    {
      views,
      memberOf: currentMember,
      payments: payments.mode,
      demoBooking: payments.demoBooking,
      // A booked trip's prices are not checked again.
      scheduleRefresh: () => undefined,
    },
    groupId,
    planId,
    new Date(),
  );
}
