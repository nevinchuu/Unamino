import type { MembershipService } from "@/domain/group/membership-service";
import type { Member } from "@/domain/group/types";
import { isUuid } from "./ids";

/** What the screen is told. `joinToken` is the new invite link's secret when removing someone replaced it; it is shown once and never stored in clear. */
export type ManageResult = { readonly ok: true; readonly joinToken?: string; readonly accessToken?: string; readonly planEnded?: boolean } | { readonly ok: false; readonly error: string };

export interface MembershipActionDeps {
  readonly membership: Pick<MembershipService, "leave" | "remove" | "makeAdmin" | "deleteGroup" | "issueAccessLink">;
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

export async function runRemove(deps: MembershipActionDeps, member: Member | null, input: { readonly groupId: string; readonly targetMemberId: string; readonly resetLink: boolean }): Promise<ManageResult> {
  if (!inGroup(member, input.groupId)) return { ok: false, error: NOT_SIGNED_IN };
  if (!isUuid(input.targetMemberId)) return { ok: false, error: NOT_FOUND };
  const removed = await deps.membership.remove(member, input.targetMemberId, { resetLink: input.resetLink });
  if (!removed.ok) return { ok: false, error: removed.error.message };
  return { ok: true, planEnded: removed.value.planEnded, ...(removed.value.newJoinToken && { joinToken: removed.value.newJoinToken }) };
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
