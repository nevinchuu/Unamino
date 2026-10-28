import { handleEarlier } from "@/server/chat";
import { getContainer } from "@/server/container";
import { currentMember } from "@/server/session";

export async function GET(request: Request, context: RouteContext<"/api/groups/[groupId]/earlier">): Promise<Response> {
  const { groupId } = await context.params;
  const { groups, messages } = getContainer();
  return handleEarlier(request, groupId, { groups, messages, memberOf: currentMember });
}
