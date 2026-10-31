import type { Member } from "@/domain/group/types";
import type { PaymentsMode } from "@/domain/payments/types";
import { buildPlanView, LIVE_PLAN_STATUSES, type PlanViewDto } from "@/domain/plan/view";
import type { PlanViewRaw, PlanViewStore } from "@/domain/plan/view-store";
import type { TravellerService } from "@/domain/travellers/service";
import { isUuid } from "./ids";

export interface PlanViewDeps {
  readonly views: Pick<PlanViewStore, "load">;
  /** Who is asking, in this group. Null for anyone who is not a member of it. */
  readonly memberOf: (groupId: string) => Promise<Member | null>;
  /** How money is handled, so the screen shows a card form, a demo note, or nothing. */
  readonly payments: PaymentsMode;
  /** True when booking is only pretended. */
  readonly demoBooking?: boolean;
  /** Null when this server does not take traveller details. */
  readonly travellers?: Pick<TravellerService, "haveDetails"> | null;
  /** Asks for the offers to be checked again once the response is on its way. Never waited for. */
  readonly scheduleRefresh: (planId: string) => void;
  /** Asks for a plan that has been booking for too long, or has been waiting to start booking for too long, to be settled once the response is on its way. Never waited for. */
  readonly scheduleSettle?: (planId: string) => void;
  /** Asks for the holds of a plan that is waiting for them to be checked against the payment provider once the response is on its way. Never waited for. */
  readonly scheduleReconcile?: (plan: PlanViewRaw) => void;
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
  // A plan stuck booking, or stuck waiting to start booking after the last hold, would otherwise wait for the next scheduled sweep, which on the free plan can be a day away.
  if (raw.value.status === "booking" || raw.value.status === "held") deps.scheduleSettle?.(planId);
  // A person may have closed the page after putting a card on the hold and before the app heard about it.
  if (raw.value.status === "approving") deps.scheduleReconcile?.(raw.value);
  return { ok: true, view: buildPlanView(raw.value, member.id, { payments: deps.payments, demoBooking: deps.demoBooking, travellers: await travellerStatus(deps, member.id) }) };
}

/** Whether the viewer has given their details. Undefined when details are not taken here, or the store cannot be reached (the screen then does not ask). */
async function travellerStatus(deps: PlanViewDeps, memberId: string): Promise<{ readonly given: boolean } | undefined> {
  if (!deps.travellers) return undefined;
  const have = await deps.travellers.haveDetails([memberId]);
  return have.ok ? { given: have.value.has(memberId) } : undefined;
}

const json = (body: unknown, status: number): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The screen's regular question: where does the plan stand now? */
export async function handlePlanView(planId: string, deps: PlanViewDeps): Promise<Response> {
  const loaded = await loadPlanViewFor(deps, planId);
  if (loaded.ok) return json(loaded.view, 200);
  return loaded.reason === "not_found" ? json({ error: "not_found" }, 404) : json({ error: "unavailable" }, 503);
}
