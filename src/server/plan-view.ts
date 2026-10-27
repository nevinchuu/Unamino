import type { Member } from "@/domain/group/types";
import { buildPlanView, LIVE_PLAN_STATUSES, type PlanViewDto } from "@/domain/plan/view";
import type { PlanViewStore } from "@/domain/plan/view-store";
import { isUuid } from "./ids";

export interface PlanViewDeps {
  readonly views: Pick<PlanViewStore, "load">;
  /** Who is asking, in this group. Null for anyone who is not a member of it. */
  readonly memberOf: (groupId: string) => Promise<Member | null>;
  /** True when card holds are pretended, so the screen says so. */
  readonly demoHolds: boolean;
  /** Asks for the offers to be checked again once the response is on its way. Never waited for. */
  readonly scheduleRefresh: (planId: string) => void;
}

export type LoadedPlanView = { readonly ok: true; readonly view: PlanViewDto } | { readonly ok: false; readonly reason: "not_found" | "unavailable" };

/**
 * One person's view of a plan. A plan that does not exist, a malformed id and a plan in a group the person is not
 * in all give the same answer, so this cannot be used to find out which plans exist.
 */
export async function loadPlanViewFor(deps: PlanViewDeps, planId: string): Promise<LoadedPlanView> {
  if (!isUuid(planId)) return { ok: false, reason: "not_found" };

  const raw = await deps.views.load(planId);
  if (!raw.ok) return { ok: false, reason: raw.error.code === "not_found" ? "not_found" : "unavailable" };

  const member = await deps.memberOf(raw.value.groupId);
  if (!member) return { ok: false, reason: "not_found" };

  // Prices are checked after the answer is sent, so nobody waits for the airline and hotel searches.
  if (LIVE_PLAN_STATUSES.includes(raw.value.status)) deps.scheduleRefresh(planId);
  return { ok: true, view: buildPlanView(raw.value, member.id, { demoHolds: deps.demoHolds }) };
}

const json = (body: unknown, status: number): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The screen's regular question: where does the plan stand now? */
export async function handlePlanView(planId: string, deps: PlanViewDeps): Promise<Response> {
  const loaded = await loadPlanViewFor(deps, planId);
  if (loaded.ok) return json(loaded.view, 200);
  return loaded.reason === "not_found" ? json({ error: "not_found" }, 404) : json({ error: "unavailable" }, 503);
}
