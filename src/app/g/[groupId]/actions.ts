"use server";

import { after } from "next/server";
import { runAgent } from "@/domain/agent/run-agent";
import type { ChatMessageDto } from "@/server/chat";
import { getContainer } from "@/server/container";
import { groupErrorMessage, type FormState } from "@/server/forms";
import { sendChatMessage } from "@/server/send-message";
import { runRemind, type RemindResult } from "@/server/remind";
import { currentMember, rememberInviteToken } from "@/server/session";

export type SendResult = { readonly ok: true; readonly message: ChatMessageDto } | { readonly ok: false; readonly error: string };

/**
 * Posts a message from the chat's composer. When it calls the agent, the run is started here and carried out after
 * the person has their answer, because a run takes about a minute and the chat must not wait for it.
 */
export async function sendMessage(groupId: string, body: string, replyToMessageId: string | null): Promise<SendResult> {
  const { messages, agent } = getContainer();
  const sent = await sendChatMessage({ messages, agent }, await currentMember(groupId), { groupId, body, replyToMessageId });
  if (!sent.ok) return { ok: false, error: sent.error.message };

  const { run } = sent.value;
  if (run) after(() => runAgent(agent, run));
  return { ok: true, message: sent.value.message };
}

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

/** Nudges the people the plan is waiting for, with a line in the chat in the sender's name. Held back for a few minutes after each one. */
export async function remindGroup(groupId: string, planId: string): Promise<RemindResult> {
  const { views, messages, agent } = getContainer();
  return runRemind({ views, messages, clock: agent.clock }, await currentMember(groupId), { groupId, planId });
}
