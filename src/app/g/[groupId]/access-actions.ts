"use server";

import { runMakeAccessLink, type AccessLinkResult } from "@/server/access-link";
import { getContainer } from "@/server/container";
import { currentMember, rememberMember } from "@/server/session";

/**
 * Makes the person's access link and keeps this browser signed in with it, because making it replaced the secret every other
 * browser had. The secret is handed back once, for the page to show as a link, and is never stored in clear.
 */
export async function makeAccessLink(groupId: string): Promise<AccessLinkResult> {
  const result = await runMakeAccessLink(getContainer(), await currentMember(groupId), groupId);
  if (result.ok) await rememberMember(groupId, result.token);
  return result;
}
