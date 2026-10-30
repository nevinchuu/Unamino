import type { MessageRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import type { CoverError, CoverService } from "@/domain/plan/cover-service";
import type { PlanViewStore } from "@/domain/plan/view-store";
import { formatMinor } from "@/lib/format-money";
import { isUuid } from "./ids";

/** What the screen is told. "unchanged": it was already exactly like that, so nobody has to look again. */
export type CoverActionResult = { readonly ok: true; readonly outcome: "changed" | "unchanged" } | { readonly ok: false; readonly error: string };

/** What the person asks for: the whole share, a percent of it (follows the price), a fixed amount in the plan's currency (minor units), or to stop. */
export type CoverChange = { readonly kind: "all" } | { readonly kind: "percent"; readonly percent: number } | { readonly kind: "amount"; readonly amountMinor: number } | { readonly kind: "stop" };

export interface CoverInput {
  readonly planId: string;
  readonly beneficiaryId: string;
  readonly change: CoverChange;
}

export interface CoverActionDeps {
  readonly covers: Pick<CoverService, "set" | "remove">;
  readonly views: Pick<PlanViewStore, "load">;
  readonly messages: Pick<MessageRepository, "postSystem">;
}

const NOT_SIGNED_IN = "Open your invite link to rejoin this group.";
const NOT_FOUND = "We couldn't find that plan.";
const NOT_IN_PLAN = "You're not part of this plan.";
const TRY_AGAIN = "Something went wrong on our side. Try again in a moment.";

/** What to tell a person when the cover was refused. The reasons from the domain are plain words already. */
export function describeCoverError(error: CoverError, currency: string): string {
  switch (error.kind) {
    case "not_in_plan":
      return "They aren't part of this plan.";
    case "not_open":
      return "The plan has moved on, so who pays what can't change now.";
    case "invalid":
      return error.message;
    case "too_much":
      return `That's more than their share, which is ${formatMinor(error.ownPartBaseMinor, currency)}.`;
    case "unavailable":
      return TRY_AGAIN;
  }
}

/**
 * A friend covering some or all of another member's share. The sponsor is always the person asking, taken from their
 * cookie and never from the request, so nobody can volunteer someone else's money. The group is told in the chat, by
 * name, so the person being covered hears about it.
 */
export async function runCoverAction(deps: CoverActionDeps, member: Member | null, input: CoverInput): Promise<CoverActionResult> {
  if (!member) return { ok: false, error: NOT_SIGNED_IN };
  if (!isUuid(input.planId) || !isUuid(input.beneficiaryId)) return { ok: false, error: NOT_FOUND };
  const { change } = input;
  if (change.kind === "amount" && !(Number.isSafeInteger(change.amountMinor) && change.amountMinor > 0)) {
    return { ok: false, error: "That amount didn't look right. Enter more than zero." };
  }
  if (change.kind === "percent" && !(Number.isInteger(change.percent) && change.percent >= 1 && change.percent <= 99)) {
    return { ok: false, error: "That share didn't look right. Pick a whole percent between 1 and 99." };
  }

  const plan = await deps.views.load(input.planId);
  if (!plan.ok) return { ok: false, error: plan.error.code === "not_found" ? NOT_FOUND : TRY_AGAIN };
  // A plan in someone else's group gets the same answer as a plan that does not exist.
  if (plan.value.groupId !== member.groupId) return { ok: false, error: NOT_FOUND };
  if (!plan.value.members.some((person) => person.id === member.id)) return { ok: false, error: NOT_IN_PLAN };
  const beneficiary = plan.value.members.find((person) => person.id === input.beneficiaryId);
  if (!beneficiary) return { ok: false, error: describeCoverError({ kind: "not_in_plan", message: "" }, plan.value.baseCurrency) };

  const { planId } = input;
  const result =
    change.kind === "stop" ? await deps.covers.remove(planId, member.id, beneficiary.id)
    : change.kind === "all" ? await deps.covers.set(planId, member.id, beneficiary.id, { kind: "all" })
    : change.kind === "percent" ? await deps.covers.set(planId, member.id, beneficiary.id, { kind: "percent", percent: change.percent })
    : await deps.covers.set(planId, member.id, beneficiary.id, { kind: "amount", amountBaseMinor: change.amountMinor });
  if (!result.ok) return { ok: false, error: describeCoverError(result.error, plan.value.baseCurrency) };
  if (result.value.status === "unchanged") return { ok: true, outcome: "unchanged" };

  const what =
    change.kind === "all" ? `${beneficiary.name}'s whole share`
    : change.kind === "percent" ? (change.percent === 50 ? `half of ${beneficiary.name}'s share` : `${change.percent}% of ${beneficiary.name}'s share`)
    : change.kind === "amount" ? `${formatMinor(change.amountMinor, plan.value.baseCurrency)} of ${beneficiary.name}'s share`
    : null;
  await deps.messages.postSystem(member.groupId, what ? `${member.displayName} is covering ${what}.` : `${member.displayName} is no longer covering ${beneficiary.name}'s share.`);
  return { ok: true, outcome: "changed" };
}
