"use server";

import { redirect } from "next/navigation";
import { getContainer } from "@/server/container";
import { groupErrorMessage, parseJoin, type FormState } from "@/server/forms";
import { GROUP_CURRENCY } from "@/server/group-currency";
import { currentMember, rememberMember } from "@/server/session";

/** Joins the group the link belongs to, signs the person in, and takes them to the group. */
export async function joinGroup(joinToken: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseJoin(formData);
  if (!parsed.ok) return parsed.error;
  const { yourName } = parsed.value;
  const values = { yourName };

  const { groups } = getContainer();
  const preview = await groups.describeJoinLink(joinToken);
  if (!preview.ok) return { message: groupErrorMessage(preview.error), values };

  // Someone who is already in must not become a second person by opening the link again.
  if (await currentMember(preview.value.groupId)) redirect(`/g/${preview.value.groupId}`);

  const joined = await groups.joinWithLink(joinToken, { displayName: yourName, currency: GROUP_CURRENCY });
  if (!joined.ok) return { message: groupErrorMessage(joined.error), values };

  await rememberMember(joined.value.group.id, joined.value.memberToken);
  redirect(`/g/${joined.value.group.id}`);
}
