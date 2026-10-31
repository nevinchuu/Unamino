"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientAddressOf, creatorKeyFor } from "@/server/client-key";
import { getContainer } from "@/server/container";
import { GROUP_CURRENCY } from "@/server/group-currency";
import { groupErrorMessage, parseCreateGroup, type FormState } from "@/server/forms";
import { groupCreationVerdict, TOO_MANY_BY_YOU, TOO_MANY_GROUPS } from "@/server/group-rate";
import { rememberInviteToken, rememberMember } from "@/server/session";

/** Makes a group, signs its creator in as the organiser, and keeps the invite link for them to share. */
export async function createGroup(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseCreateGroup(formData);
  if (!parsed.ok) return parsed.error;
  const { groupName, yourName } = parsed.value;

  const { groups, groupCounter, cronSecret } = getContainer();
  const creatorKey = creatorKeyFor(clientAddressOf(await headers()), cronSecret);
  const verdict = await groupCreationVerdict(groupCounter, new Date(), creatorKey);
  if (verdict !== "allowed") return { message: verdict === "person_limit" ? TOO_MANY_BY_YOU : TOO_MANY_GROUPS, values: { groupName, yourName } };

  const created = await groups.create({
    name: groupName,
    baseCurrency: GROUP_CURRENCY,
    organiser: { displayName: yourName, currency: GROUP_CURRENCY },
    creatorKey,
  });
  if (!created.ok) return { message: groupErrorMessage(created.error), values: { groupName, yourName } };

  const { group, memberToken, joinToken } = created.value;
  await rememberMember(group.id, memberToken);
  await rememberInviteToken(group.id, joinToken);
  // Outside any try block: redirect works by throwing.
  redirect(`/g/${group.id}`);
}
