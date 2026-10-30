"use server";

import { after } from "next/server";
import { runAgent } from "@/domain/agent/run-agent";
import { getContainer } from "@/server/container";
import { runCoverAction, type CoverActionResult, type CoverChange } from "@/server/cover-actions";
import { runCardForm, runConfirmHold, type CardFormResult, type ConfirmHoldResult } from "@/server/hold-actions";
import { runSaveTravellerDetails, type SaveDetailsResult } from "@/server/traveller-actions";
import { runPlanAction, type PlanActionName, type PlanActionResult } from "@/server/plan-actions";
import { runRequestChanges, type RequestChangesResult } from "@/server/request-changes";
import { currentMember } from "@/server/session";

/** Test personas look at where the plan stands after anything a person does to it. */
function kickPersonas(groupId: string): void {
  const { personas } = getContainer();
  if (personas) after(() => personas.director.kick(groupId));
}

async function act(groupId: string, planId: string, action: PlanActionName, seenMinor?: number): Promise<PlanActionResult> {
  const { plans, views, messages } = getContainer();
  const result = await runPlanAction({ plans, views, messages, clock: () => new Date() }, await currentMember(groupId), { planId, action, seenMinor });
  if (result.ok) kickPersonas(groupId);
  return result;
}

/** Step 1: agree to the plan. `seenMinor` is the price the person was shown. */
export async function agreeToPlan(groupId: string, planId: string, seenMinor: number): Promise<PlanActionResult> {
  return act(groupId, planId, "agree", seenMinor);
}

/** Step 1: say no, which ends the plan for everyone. */
export async function declinePlan(groupId: string, planId: string): Promise<PlanActionResult> {
  return act(groupId, planId, "decline");
}

/** Step 2: approve paying. The amount is today's price, decided on the server; `seenMinor` only proves they saw it. */
export async function approvePlanAmount(groupId: string, planId: string, seenMinor: number): Promise<PlanActionResult> {
  return act(groupId, planId, "approve", seenMinor);
}

/** Step 2: back out, which ends the plan for everyone and gives every hold back. */
export async function declinePlanAmount(groupId: string, planId: string): Promise<PlanActionResult> {
  return act(groupId, planId, "declineAmount");
}

/** Makes the person's card hold (or finds it) and returns what Stripe's card form needs. Only for the person it belongs to. */
export async function openCardForm(groupId: string, planId: string): Promise<CardFormResult> {
  const { payments, views, travellers } = getContainer();
  return runCardForm({ holds: payments.holds, views, travellers }, await currentMember(groupId), planId);
}

/** After the card was confirmed in the browser: asks Stripe whether the hold is really there, and records it if so. */
export async function confirmCardHold(groupId: string, planId: string): Promise<ConfirmHoldResult> {
  const { payments, views } = getContainer();
  const result = await runConfirmHold({ holds: payments.holds, views }, await currentMember(groupId), planId);
  if (result.ok) kickPersonas(groupId);
  return result;
}

/**
 * A friend covers some or all of another member's share (or stops). The person covering is whoever is signed in. This
 * sends everyone back to agree to the plan again, because their amounts changed.
 */
export async function coverShare(groupId: string, planId: string, beneficiaryId: string, change: CoverChange): Promise<CoverActionResult> {
  const { covers, views, messages } = getContainer();
  const result = await runCoverAction({ covers, views, messages }, await currentMember(groupId), { planId, beneficiaryId, change });
  if (result.ok) kickPersonas(groupId);
  return result;
}

/** Keeps the person's traveller details, locked. The airline and the hotel need them. Only for the person they belong to. */
export async function saveTravellerDetails(groupId: string, planId: string, input: unknown): Promise<SaveDetailsResult> {
  const { travellers, views, payments } = getContainer();
  const result = await runSaveTravellerDetails({ travellers, views, holds: payments.holds }, await currentMember(groupId), planId, input);
  if (result.ok) kickPersonas(groupId);
  return result;
}

/**
 * Asks Trippy to change the plan instead of ending it. The request goes into the chat as the person's own message,
 * and Trippy answers there; the run is carried out after the person has their answer, because it takes about a minute.
 */
export async function requestPlanChanges(groupId: string, planId: string, reason: string, note: string): Promise<RequestChangesResult> {
  const { views, messages, agent, payments, personas } = getContainer();
  const sent = await runRequestChanges({ views, send: { messages, agent }, payments: payments.mode }, await currentMember(groupId), { planId, reason, note });
  if (!sent.ok) return { ok: false, error: sent.error };
  const { run } = sent.value;
  if (run || personas) {
    after(async () => {
      if (run) await runAgent(agent, run);
      await personas?.director.kick(groupId);
    });
  }
  return { ok: true, asked: sent.value.asked };
}
