import type { AgentRun } from "@/domain/agent/ports";
import type { MembershipService } from "@/domain/group/membership-service";
import type { MessageRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import { REPLAN_FAILED_LINE, removedFriendRequest } from "@/lib/replan-request";
import { isUuid } from "./ids";
import { sendChatMessage, type SendDeps } from "./send-message";

/** What the screen is told. `joinToken` is the new invite link's secret when removing someone replaced it; it is shown once and never stored in clear. */
export type ManageResult = { readonly ok: true; readonly joinToken?: string; readonly accessToken?: string; readonly planEnded?: boolean } | { readonly ok: false; readonly error: string };

/** What removing someone gives back to the server action: the screen's answer, and the run that makes the new plan if Trippy was asked to. */
export type RemoveResult = ManageResult & { readonly run?: AgentRun };

export interface MembershipActionDeps {
  readonly membership: Pick<MembershipService, "leave" | "remove" | "makeAdmin" | "deleteGroup" | "issueAccessLink">;
  /** For asking Trippy to plan again, in the admin's name, when removing someone ends the open plan. */
  readonly messages: SendDeps["messages"] & Pick<MessageRepository, "postSystem">;
  readonly agent: SendDeps["agent"];
}

const NOT_SIGNED_IN = "Open your invite link to rejoin this group.";
const NOT_FOUND = "We couldn't find that person.";

/** Someone who holds a token for another group must not act on this one, even if the token is real. */
const inGroup = (member: Member | null, groupId: string): member is Member => member !== null && member.groupId === groupId;

export async function runLeave(deps: MembershipActionDeps, member: Member | null, groupId: string): Promise<ManageResult> {
  if (!inGroup(member, groupId)) return { ok: false, error: NOT_SIGNED_IN };
  const left = await deps.membership.leave(member);
  return left.ok ? { ok: true, planEnded: left.value.planEnded } : { ok: false, error: left.error.message };
}

/**
 * Removes someone. If that ended the open plan, Trippy is asked to make a new one for the people left, in the admin's own
 * name like any change request, and the run is handed back for the caller to carry out once the admin has their answer.
 * When Trippy cannot be asked, the chat says to mention it, so the group is never left without the next step.
 */
export async function runRemove(deps: MembershipActionDeps, member: Member | null, input: { readonly groupId: string; readonly targetMemberId: string; readonly resetLink: boolean }): Promise<RemoveResult> {
  if (!inGroup(member, input.groupId)) return { ok: false, error: NOT_SIGNED_IN };
  if (!isUuid(input.targetMemberId)) return { ok: false, error: NOT_FOUND };
  const removed = await deps.membership.remove(member, input.targetMemberId, { resetLink: input.resetLink, replanFollows: true });
  if (!removed.ok) return { ok: false, error: removed.error.message };

  const answer: ManageResult = { ok: true, planEnded: removed.value.planEnded, ...(removed.value.newJoinToken && { joinToken: removed.value.newJoinToken }) };
  if (!removed.value.planEnded || !removed.value.removedName) return answer;

  const asked = await sendChatMessage(deps, member, { groupId: input.groupId, body: removedFriendRequest(removed.value.removedName), replyToMessageId: null });
  const run = asked.ok ? asked.value.run : null;
  if (run === null) await deps.messages.postSystem(input.groupId, REPLAN_FAILED_LINE);
  return run ? { ...answer, run } : answer;
}

export async function runMakeAdmin(deps: MembershipActionDeps, member: Member | null, input: { readonly groupId: string; readonly targetMemberId: string }): Promise<ManageResult> {
  if (!inGroup(member, input.groupId)) return { ok: false, error: NOT_SIGNED_IN };
  if (!isUuid(input.targetMemberId)) return { ok: false, error: NOT_FOUND };
  const made = await deps.membership.makeAdmin(member, input.targetMemberId);
  return made.ok ? { ok: true } : { ok: false, error: made.error.message };
}

/** `accessToken` is the new secret for the person, handed back once for the admin to pass on. */
export async function runIssueAccessLink(deps: MembershipActionDeps, member: Member | null, input: { readonly groupId: string; readonly targetMemberId: string }): Promise<ManageResult> {
  if (!inGroup(member, input.groupId)) return { ok: false, error: NOT_SIGNED_IN };
  if (!isUuid(input.targetMemberId)) return { ok: false, error: NOT_FOUND };
  const issued = await deps.membership.issueAccessLink(member, input.targetMemberId);
  return issued.ok ? { ok: true, accessToken: issued.value } : { ok: false, error: issued.error.message };
}

export async function runDeleteGroup(deps: MembershipActionDeps, member: Member | null, input: { readonly groupId: string; readonly typedName: string }): Promise<ManageResult> {
  if (!inGroup(member, input.groupId)) return { ok: false, error: NOT_SIGNED_IN };
  const deleted = await deps.membership.deleteGroup(member, input.typedName);
  return deleted.ok ? { ok: true } : { ok: false, error: deleted.error.message };
}
