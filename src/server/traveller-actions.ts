import type { Member } from "@/domain/group/types";
import type { PlanViewStore } from "@/domain/plan/view-store";
import type { TravellerFieldErrors } from "@/domain/travellers/details";
import { passportRequiredFor } from "@/domain/travellers/requirements";
import type { TravellerService } from "@/domain/travellers/service";
import { isUuid } from "./ids";

/** `fields` names what to fix, each worded for the person. */
export type SaveDetailsResult = { readonly ok: true } | { readonly ok: false; readonly error: string; readonly fields?: TravellerFieldErrors };

export interface TravellerActionDeps {
  /** Null when this server does not take traveller details. */
  readonly travellers: Pick<TravellerService, "save"> | null;
  readonly views: Pick<PlanViewStore, "load">;
}

const NOT_SIGNED_IN = "Open your invite link to rejoin this group.";
const NOT_FOUND = "We couldn't find that plan.";
const NOT_SET_UP = "Traveller details are not set up on this server.";
const UNAVAILABLE = "Couldn't save your details. Try again in a moment.";
const NOT_IN_PLAN = "You are not part of this plan.";
const NOT_NOW = "This plan isn't asking for details right now.";

/** The plan states in which people are paying, and so in which their details are asked for. */
const ASKING = ["approving", "held"] as const;

/**
 * Takes one person's traveller details for a plan they are in. Only for themselves: the person comes from their
 * cookie, never from the request. Whether a passport is needed is worked out here from the plan, not taken from the form.
 */
export async function runSaveTravellerDetails(deps: TravellerActionDeps, member: Member | null, planId: string, input: unknown): Promise<SaveDetailsResult> {
  if (!member) return { ok: false, error: NOT_SIGNED_IN };
  if (!isUuid(planId)) return { ok: false, error: NOT_FOUND };
  if (!deps.travellers) return { ok: false, error: NOT_SET_UP };

  const plan = await deps.views.load(planId);
  if (!plan.ok) return { ok: false, error: plan.error.code === "not_found" ? NOT_FOUND : UNAVAILABLE };
  // A plan in someone else's group gets the same answer as a plan that does not exist.
  if (plan.value.groupId !== member.groupId) return { ok: false, error: NOT_FOUND };
  if (!plan.value.members.some((person) => person.id === member.id)) return { ok: false, error: NOT_IN_PLAN };
  if (!(ASKING as readonly string[]).includes(plan.value.status)) return { ok: false, error: NOT_NOW };

  const saved = await deps.travellers.save(member.id, input, { passportRequired: passportRequiredFor(plan.value.picks, member.id) });
  if (saved.ok) return { ok: true };
  if (saved.error.kind === "invalid") return { ok: false, error: "Check the fields marked below.", fields: saved.error.fields };
  console.error("saving traveller details failed");
  return { ok: false, error: UNAVAILABLE };
}
