"use server";

import { getContainer } from "@/server/container";
import { runPlanAction, type PlanActionName, type PlanActionResult } from "@/server/plan-actions";
import { currentMember } from "@/server/session";

async function act(groupId: string, planId: string, action: PlanActionName, seenMinor?: number): Promise<PlanActionResult> {
  const { plans, views, messages } = getContainer();
  return runPlanAction({ plans, views, messages, clock: () => new Date() }, await currentMember(groupId), { planId, action, seenMinor });
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
