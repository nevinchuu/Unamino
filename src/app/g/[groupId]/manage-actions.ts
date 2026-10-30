"use server";

import { getContainer } from "@/server/container";
import { runDeleteGroup, runLeave, runMakeAdmin, runRemove, type ManageResult } from "@/server/membership-actions";
import { currentMember, forgetMember, rememberInviteToken } from "@/server/session";

/** The person leaves. Their browser forgets the group so it drops off the trips list. */
export async function leaveGroup(groupId: string): Promise<ManageResult> {
  const result = await runLeave(getContainer(), await currentMember(groupId), groupId);
  if (result.ok) await forgetMember(groupId);
  return result;
}

/**
 * The admin removes someone. With `resetLink` the invite link is replaced as well, so the person cannot just join again, and
 * the new link is kept for the admin to copy.
 */
export async function removeMember(groupId: string, targetMemberId: string, resetLink: boolean): Promise<ManageResult> {
  const result = await runRemove(getContainer(), await currentMember(groupId), { groupId, targetMemberId, resetLink });
  if (result.ok && result.joinToken) await rememberInviteToken(groupId, result.joinToken);
  return result.ok ? { ok: true, planEnded: result.planEnded } : result;
}

export async function makeGroupAdmin(groupId: string, targetMemberId: string): Promise<ManageResult> {
  return runMakeAdmin(getContainer(), await currentMember(groupId), { groupId, targetMemberId });
}

/** The admin deletes the group for everyone. `typedName` must be the group's name. */
export async function deleteGroup(groupId: string, typedName: string): Promise<ManageResult> {
  const result = await runDeleteGroup(getContainer(), await currentMember(groupId), { groupId, typedName });
  if (result.ok) await forgetMember(groupId);
  return result;
}
