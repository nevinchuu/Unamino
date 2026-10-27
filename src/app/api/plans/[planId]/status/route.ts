import { getContainer } from "@/server/container";
import { handlePlanStatus } from "@/server/status-handler";

export async function GET(_request: Request, context: RouteContext<"/api/plans/[planId]/status">): Promise<Response> {
  const { planId } = await context.params;
  return handlePlanStatus(planId, getContainer().planStatus);
}
