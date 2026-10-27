import type { MessageRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import type { PlanService, ServiceError } from "@/domain/plan/service";
import type { PlanViewStore } from "@/domain/plan/view-store";
import { isUuid } from "./ids";

export type PlanActionName = "agree" | "decline" | "approve" | "declineAmount";

/** What the screen is told. Plain data, because it crosses from the server to the browser. */
export type PlanActionResult =
  | { readonly ok: true; readonly outcome: "done" }
  /** Nothing was recorded: the price rose since the person looked. They should see the new one first. */
  | { readonly ok: true; readonly outcome: "price_changed"; readonly currentMinor: number }
  | { readonly ok: true; readonly outcome: "plan_ended"; readonly reason: "listing_unavailable" | "deadline_passed" }
  | { readonly ok: false; readonly error: string };

export interface PlanActionDeps {
  readonly plans: Pick<PlanService, "agree" | "decline" | "approveAmount" | "declineAmount">;
  readonly views: Pick<PlanViewStore, "groupIdOf">;
  readonly messages: Pick<MessageRepository, "postSystem">;
  readonly clock: () => Date;
}

const fail = (error: string): PlanActionResult => ({ ok: false, error });

const NOT_SIGNED_IN = "Open your invite link to rejoin this group.";
const NOT_FOUND = "We couldn't find that plan.";
const TRY_AGAIN = "Something went wrong on our side. Try again in a moment.";

const NEW_PLAN_HINT = "Mention @trippy to start a new one.";

/** What to tell a person when an action was refused. Never the internal reason. */
export function describeServiceError(error: ServiceError): string {
  switch (error.kind) {
    case "transition":
      return error.error.code === "unknown_member" ? "You're not part of this plan." : "The plan has moved on, so that can't be done now. The screen will show where it stands.";
    case "unknown_member":
      return "You're not part of this plan.";
    case "search_failed":
    case "prices_stale":
      return "Couldn't check the latest prices. Try again in a moment.";
    case "pricing_failed":
      return "The prices can't be worked out right now. Try again in a moment.";
    case "invalid_amount":
      return "That price didn't look right. Reload the plan and try again.";
    case "repository":
      return TRY_AGAIN;
  }
}

/**
 * What a person does on the plan screen. The person must be in the plan's own group, which is checked here and not
 * trusted from the page, because an action can be called without ever opening the page. A person's amount is never
 * taken from them: `seenMinor` is only the price they were shown, which the service compares with today's.
 */
export async function runPlanAction(
  deps: PlanActionDeps,
  member: Member | null,
  input: { readonly planId: string; readonly action: PlanActionName; readonly seenMinor?: number },
): Promise<PlanActionResult> {
  if (!member) return fail(NOT_SIGNED_IN);
  if (!isUuid(input.planId)) return fail(NOT_FOUND);

  const group = await deps.views.groupIdOf(input.planId);
  if (!group.ok) return fail(TRY_AGAIN);
  // A plan in someone else's group gets the same answer as a plan that does not exist.
  if (group.value !== member.groupId) return fail(NOT_FOUND);

  const { planId, action, seenMinor } = input;
  const now = deps.clock();
  const needsPrice = action === "agree" || action === "approve";
  if (needsPrice && typeof seenMinor !== "number") return fail("That price didn't look right. Reload the plan and try again.");

  const result =
    action === "agree" ? await deps.plans.agree(planId, member.id, seenMinor as number, now)
    : action === "approve" ? await deps.plans.approveAmount(planId, member.id, seenMinor as number, now)
    : action === "decline" ? await deps.plans.decline(planId, member.id, now)
    : await deps.plans.declineAmount(planId, member.id, now);
  if (!result.ok) return fail(describeServiceError(result.error));

  const outcome = result.value;
  const say = async (line: string) => void (await deps.messages.postSystem(member.groupId, line));

  if (outcome.status === "price_changed") return { ok: true, outcome: "price_changed", currentMinor: outcome.currentMinor };
  if (outcome.status === "plan_ended") {
    await say(outcome.reason === "listing_unavailable" ? `A flight or hotel in the plan is no longer available, so the plan has ended. ${NEW_PLAN_HINT}` : `The plan ran out of time, so it has ended. ${NEW_PLAN_HINT}`);
    return { ok: true, outcome: "plan_ended", reason: outcome.reason };
  }

  if (action === "decline") await say(`${member.displayName} declined the plan, so it has ended. ${NEW_PLAN_HINT}`);
  if (action === "declineAmount") await say(`${member.displayName} backed out, so the plan has ended and any card holds were released. ${NEW_PLAN_HINT}`);
  return { ok: true, outcome: "done" };
}
