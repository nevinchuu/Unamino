import type { GroupRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import { isTokenShaped } from "@/lib/tokens";

export type AccessLinkResult = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly error: string };

const NOT_SIGNED_IN = "Open your invite link to rejoin this group.";
const TRY_AGAIN = "Something went wrong on our side. Try again in a moment.";

/**
 * Makes the person's access link. It is their own sign-in secret, replaced with a new one, so the caller must keep the
 * browser they are in signed in with it: any other browser, and any older copy of the link, stops working.
 */
export async function runMakeAccessLink(deps: { readonly groups: Pick<GroupRepository, "replaceMemberToken"> }, member: Member | null, groupId: string): Promise<AccessLinkResult> {
  if (!member || member.groupId !== groupId) return { ok: false, error: NOT_SIGNED_IN };
  const replaced = await deps.groups.replaceMemberToken(member.id);
  return replaced.ok ? { ok: true, token: replaced.value } : { ok: false, error: TRY_AGAIN };
}

/** Who an access link signs in, for the page that asks "continue as ...?". Nothing is changed by looking. */
export interface AccessLinkPreview {
  readonly groupId: string;
  readonly groupName: string;
  readonly memberName: string;
}

export type AccessLinkLookup = { readonly ok: true; readonly preview: AccessLinkPreview } | { readonly ok: false };

/** A link that is malformed, replaced by a newer one, or for someone who has left all look the same: it does not work. */
export async function lookUpAccessLink(deps: { readonly groups: Pick<GroupRepository, "authenticate" | "find"> }, token: string): Promise<AccessLinkLookup> {
  if (!isTokenShaped(token)) return { ok: false };
  const member = await deps.groups.authenticate(token);
  if (!member.ok) return { ok: false };
  const group = await deps.groups.find(member.value.groupId);
  if (!group.ok) return { ok: false };
  return { ok: true, preview: { groupId: group.value.id, groupName: group.value.name, memberName: member.value.displayName } };
}
