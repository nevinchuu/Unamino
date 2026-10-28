import { after } from "next/server";
import { getContainer } from "@/server/container";
import { handlePlanView } from "@/server/plan-view";
import { currentMember } from "@/server/session";

/** The plan screen's regular question: where does the plan stand now? Prices are checked again after the answer is sent. */
export async function GET(_request: Request, context: RouteContext<"/api/plans/[planId]/view">): Promise<Response> {
  const { planId } = await context.params;
  const { views, plans, payments, travellers, bookingSweeper } = getContainer();
  return handlePlanView(planId, {
    views,
    memberOf: currentMember,
    payments: payments.mode,
    demoBooking: payments.demoBooking,
    travellers,
    scheduleRefresh: (id) => after(() => plans.refresh(id, new Date())),
    scheduleSettle: (id) => {
      if (bookingSweeper) after(() => bookingSweeper.settlePlan(id));
    },
  });
}
