"use server";

import { after } from "next/server";
import { runAgent } from "@/domain/agent/run-agent";
import { getContainer } from "@/server/container";
import { runDeleteGroup, runIssueAccessLink, runLeave, runMakeAdmin, runRemove, type ManageResult } from "@/server/membership-actions";
import { currentMember, forgetMember, rememberInviteToken } from "@/server/session";

/** The person leaves. Their browser forgets the group so it drops off the trips list. */
export async function leaveGroup(groupId: string): Promise<ManageResult> {
  const result = await runLeave(getContainer(), await currentMember(groupId), groupId);
  if (result.ok) await forgetMember(groupId);
  return result;
}

/**
 * The admin removes someone. With `resetLink` the invite link is replaced as well, so the person cannot just join again, and
 * the new link is kept for the admin to copy. If an open plan ended, Trippy then makes a new one for the people left.
 */
export async function removeMember(groupId: string, targetMemberId: string, resetLink: boolean): Promise<ManageResult> {
  const container = getContainer();
  const result = await runRemove(container, await currentMember(groupId), { groupId, targetMemberId, resetLink });
  if (result.ok && result.joinToken) await rememberInviteToken(groupId, result.joinToken);
  if (!result.ok) return result;

  // Trippy makes the new plan after the admin has their answer, because a run takes about a minute.
  const { run } = result;
  const { agent, personas } = container;
  if (run || personas) {
    after(async () => {
      if (run) await runAgent(agent, run);
      await personas?.director.kick(groupId);
    });
  }
  return { ok: true, planEnded: result.planEnded };
}

/**
 * The admin makes a new access link for someone who lost their way back in. Their old sign-in stops working, the group is told,
 * and the new link comes back once, for the admin to send them.
 */
export async function issueAccessLink(groupId: string, targetMemberId: string): Promise<ManageResult> {
  return runIssueAccessLink(getContainer(), await currentMember(groupId), { groupId, targetMemberId });
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
