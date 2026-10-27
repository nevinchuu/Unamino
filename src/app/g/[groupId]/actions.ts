"use server";

import { getContainer } from "@/server/container";
import { groupErrorMessage, type FormState } from "@/server/forms";
import { currentMember, rememberInviteToken } from "@/server/session";

/**
 * Makes a new invite link, and the old one stops working. Only the organiser can, and this checks that itself
 * rather than trusting the page, because an action can be called without ever opening the page.
 */
export async function resetInviteLink(groupId: string): Promise<FormState> {
  const member = await currentMember(groupId);
  if (!member) return { message: "Open your invite link to join this group first." };

  const replaced = await getContainer().groups.replaceJoinLink(groupId, member.id);
  if (!replaced.ok) return { message: groupErrorMessage(replaced.error) };

  await rememberInviteToken(groupId, replaced.value);
  return {};
}
