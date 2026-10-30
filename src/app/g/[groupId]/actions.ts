"use server";

import { after } from "next/server";
import { runAgent } from "@/domain/agent/run-agent";
import type { ChatMessageDto } from "@/server/chat";
import { getContainer } from "@/server/container";
import { groupErrorMessage, type FormState } from "@/server/forms";
import { sendChatMessage } from "@/server/send-message";
import { runRemind, type RemindResult } from "@/server/remind";
import type { PersonaChoice } from "@/domain/persona/service";
import { currentMember, rememberInviteToken } from "@/server/session";

export type SendResult = { readonly ok: true; readonly message: ChatMessageDto } | { readonly ok: false; readonly error: string };

/**
 * Posts a message from the chat's composer. When it calls the agent, the run is started here and carried out after
 * the person has their answer, because a run takes about a minute and the chat must not wait for it.
 */
export async function sendMessage(groupId: string, body: string, replyToMessageId: string | null): Promise<SendResult> {
  const { messages, agent, personas } = getContainer();
  const sent = await sendChatMessage({ messages, agent }, await currentMember(groupId), { groupId, body, replyToMessageId });
  if (!sent.ok) return { ok: false, error: sent.error.message };

  const { run } = sent.value;
  // Test personas answer when named, and react to whatever Trippy does with the message, so they go after the agent's run.
  if (run || personas) {
    after(async () => {
      if (run) await runAgent(agent, run);
      if (sent.value.message.senderId) await personas?.director.reply(groupId, sent.value.message.senderId, body);
      await personas?.director.kick(groupId);
    });
  }
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

export type PersonaChoicesResult = { readonly ok: true; readonly choices: readonly PersonaChoice[] } | { readonly ok: false; readonly error: string };
export type AddPersonasResult = { readonly ok: true; readonly added: readonly string[] } | { readonly ok: false; readonly error: string };

const PERSONAS_OFF = "Test personas are switched off on this server.";

/** The presets a judge can add, and which are already in the group. */
export async function loadPersonaChoices(groupId: string): Promise<PersonaChoicesResult> {
  const { personas } = getContainer();
  if (!personas) return { ok: false, error: PERSONAS_OFF };
  const member = await currentMember(groupId);
  if (!member) return { ok: false, error: "Open your invite link to join this group first." };
  return { ok: true, choices: await personas.service.choices(groupId) };
}

/** Adds the chosen test personas, then lets each say hello after the person has their answer, since each hello is a model call. */
export async function addPersonas(groupId: string, keys: readonly string[]): Promise<AddPersonasResult> {
  const { personas } = getContainer();
  if (!personas) return { ok: false, error: PERSONAS_OFF };
  const member = await currentMember(groupId);
  if (!member) return { ok: false, error: "Open your invite link to join this group first." };

  const added = await personas.service.add(member, keys);
  if (!added.ok) return { ok: false, error: added.error.message };
  if (added.value.length > 0) after(async () => {
    await personas.runner.introduce(groupId, added.value);
    await personas.director.kick(groupId);
  });
  return { ok: true, added: added.value.map((person) => person.displayName) };
}
