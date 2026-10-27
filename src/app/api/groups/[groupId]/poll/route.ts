import { handlePoll } from "@/server/chat";
import { getContainer } from "@/server/container";
import { currentMember } from "@/server/session";

export async function GET(request: Request, context: RouteContext<"/api/groups/[groupId]/poll">): Promise<Response> {
  const { groupId } = await context.params;
  return handlePoll(request, groupId, { ...getContainer().chat, memberOf: currentMember });
}
