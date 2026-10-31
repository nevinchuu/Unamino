"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { runAgent } from "@/domain/agent/run-agent";
import { DEMO_FRIEND_KEYS, DEMO_GROUP_NAME, DEMO_ORGANISER_NAME, demoPlanRequest } from "@/lib/demo-start";
import { clientAddressOf, creatorKeyFor } from "@/server/client-key";
import { getContainer } from "@/server/container";
import { GROUP_CURRENCY } from "@/server/group-currency";
import { groupErrorMessage, parseCreateGroup, type FormState } from "@/server/forms";
import { groupCreationVerdict, TOO_MANY_BY_YOU, TOO_MANY_GROUPS } from "@/server/group-rate";
import { sendChatMessage } from "@/server/send-message";
import { rememberInviteToken, rememberMember } from "@/server/session";

/** The group that was made, or what to tell the person when it was not. Nothing here redirects, so a caller can carry on before it does. */
type MadeGroup = { readonly ok: true; readonly groupId: string } | { readonly ok: false; readonly state: FormState };

/** Makes a group and signs its creator in as the organiser, keeping the invite link for them to share. Holds a person to the limit on how many groups they may make. */
async function makeGroup(groupName: string, yourName: string): Promise<MadeGroup> {
  const { groups, groupCounter, cronSecret } = getContainer();
  const creatorKey = creatorKeyFor(clientAddressOf(await headers()), cronSecret);
  const verdict = await groupCreationVerdict(groupCounter, new Date(), creatorKey);
  if (verdict !== "allowed") return { ok: false, state: { message: verdict === "person_limit" ? TOO_MANY_BY_YOU : TOO_MANY_GROUPS, values: { groupName, yourName } } };

  const created = await groups.create({
    name: groupName,
    baseCurrency: GROUP_CURRENCY,
    organiser: { displayName: yourName, currency: GROUP_CURRENCY },
    creatorKey,
  });
  if (!created.ok) return { ok: false, state: { message: groupErrorMessage(created.error), values: { groupName, yourName } } };

  const { group, memberToken, joinToken } = created.value;
  await rememberMember(group.id, memberToken);
  await rememberInviteToken(group.id, joinToken);
  return { ok: true, groupId: group.id };
}

/** Makes a group, signs its creator in as the organiser, and keeps the invite link for them to share. */
export async function createGroup(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseCreateGroup(formData);
  if (!parsed.ok) return parsed.error;

  const made = await makeGroup(parsed.value.groupName, parsed.value.yourName);
  if (!made.ok) return made.state;
  // Outside any try block: redirect works by throwing.
  redirect(`/g/${made.groupId}`);
}

/**
 * One tap to try the whole flow alone: a group with three simulated friends, and a first plan asked for in the person's
 * name. The friends say hello first, because their limits (a tight budget, a room of their own) are what Trippy plans
 * around. All of that runs after the person has landed in the chat, so they watch it happen instead of waiting for it.
 */
export async function startDemoGroup(): Promise<FormState> {
  const { personas, groups, messages, agent } = getContainer();
  if (!personas) return { message: "The demo is switched off on this server." };

  const made = await makeGroup(DEMO_GROUP_NAME, DEMO_ORGANISER_NAME);
  if (!made.ok) return made.state;
  const organiser = (await groups.joinedMembers(made.groupId)).find((member) => member.isOrganiser);
  if (!organiser) return { message: "Something went wrong on our side. Try again in a moment." };

  const added = await personas.service.add(organiser, DEMO_FRIEND_KEYS);
  if (!added.ok) return { message: added.error.message };

  const groupId = made.groupId;
  after(async () => {
    await personas.runner.introduce(groupId, added.value);
    const sent = await sendChatMessage({ messages, agent }, organiser, { groupId, body: demoPlanRequest(new Date()), replyToMessageId: null });
    if (sent.ok && sent.value.run) await runAgent(agent, sent.value.run);
    await personas.director.kick(groupId);
  });
  redirect(`/g/${groupId}`);
}
