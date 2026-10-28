"use server";

import { redirect } from "next/navigation";
import { getContainer } from "@/server/container";
import { GROUP_CURRENCY } from "@/server/group-currency";
import { groupErrorMessage, parseCreateGroup, type FormState } from "@/server/forms";
import { groupCreationAllowed, TOO_MANY_GROUPS } from "@/server/group-rate";
import { rememberInviteToken, rememberMember } from "@/server/session";

/** Makes a group, signs its creator in as the organiser, and keeps the invite link for them to share. */
export async function createGroup(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseCreateGroup(formData);
  if (!parsed.ok) return parsed.error;
  const { groupName, yourName } = parsed.value;

  const { groups, groupCounter } = getContainer();
  if (!(await groupCreationAllowed(groupCounter, new Date()))) return { message: TOO_MANY_GROUPS, values: { groupName, yourName } };

  const created = await groups.create({
    name: groupName,
    baseCurrency: GROUP_CURRENCY,
    organiser: { displayName: yourName, currency: GROUP_CURRENCY },
  });
  if (!created.ok) return { message: groupErrorMessage(created.error), values: { groupName, yourName } };

  const { group, memberToken, joinToken } = created.value;
  await rememberMember(group.id, memberToken);
  await rememberInviteToken(group.id, joinToken);
  // Outside any try block: redirect works by throwing.
  redirect(`/g/${group.id}`);
}
