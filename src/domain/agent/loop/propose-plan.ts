import { err, ok, type Result } from "@/lib/result";
import { formatMinor } from "@/lib/format-money";
import type { ConstraintSet } from "@/domain/constraints/schema";
import { applyPlanEvent } from "@/domain/plan/apply-event";
import { computePlanDeadlines } from "@/domain/plan/deadline";
import { buildPlan } from "@/domain/planner/build-plan";
import { parsePlannerOutput, type PlannerOutput } from "@/domain/planner/schema";
import type { ValidatedPlan } from "@/domain/planner/validate";
import { buildSchedule } from "@/domain/schedule/build-schedule";
import { suggestFreeTime } from "@/domain/schedule/suggest-free-time";
import type { VerifiedSuggestion } from "@/domain/schedule/verify-suggestion";
import type { CompleteTrip } from "@/domain/trip/brief";
import { findClash } from "@/domain/trip/clash";
import { nameMembers } from "../aliasing-planner";
import { computeInputsHash } from "../inputs-hash";
import { MESSAGES } from "../announce";
import { members, type ToolEnv } from "./session";
import type { PlanStatus } from "@/domain/plan/statuses";

const REQUIRED_KINDS = ["flight", "hotel"] as const;
/** While a trip is being booked, its plan can no longer be changed. */
const LOCKED_STATUSES: readonly PlanStatus[] = ["booking", "booked"];
/** A plan that has ended or been paid for is done: the group's next plan is a new trip, not a change to it. */
const FINISHED_STATUSES: readonly PlanStatus[] = ["expired", "captured"];

const asJson = (value: unknown): string => JSON.stringify(value);
const problem = (message: string): string => asJson({ error: message });

/** What the model is told when a pick breaks what someone said they need. Nothing was saved. */
const unmetNeedsMessage = (reasons: readonly string[]): string =>
  `Not saved: this plan breaks what people said they need, and those needs are non-negotiable. ${reasons.join("; ")}. ` +
  "Do not propose a plan that breaks a need. Search again for options that meet it. If none exist, or a need cannot be checked (such as a meal requirement), do not make a plan at all: " +
  "tell the group honestly that it is not available, suggest ONE concrete alternative (for example economy instead of business), and ask that person whether they accept it. " +
  "For a meal need that cannot be checked, ask whether they will confirm it with the airline or hotel themselves.";

/** Turns the model's short ids (F1, m2) back into real ones. Reports every id it cannot place, not just the first. */
function toRealIds(output: PlannerOutput, env: ToolEnv): Result<PlannerOutput, string> {
  const realMember = new Map(env.roster.map((entry) => [entry.alias, entry.member.id]));
  const unknown = new Set<string>();
  const picks = output.picks.map((pick) => {
    const offer = env.session.offersByAlias.get(pick.offerId);
    if (!offer) unknown.add(pick.offerId);
    return {
      ...pick,
      offerId: offer?.id ?? pick.offerId,
      members: pick.members.map((entry) => {
        const id = realMember.get(entry.memberId);
        if (!id) unknown.add(entry.memberId);
        return { ...entry, memberId: id ?? entry.memberId };
      }),
    };
  });
  const compromises = output.compromises?.map((entry) => ({ ...entry, memberId: realMember.get(entry.memberId) ?? entry.memberId }));
  if (unknown.size > 0) return err(`These ids are not from the latest search or the group: ${[...unknown].join(", ")}. Use only the ids search_trip gave you and m1, m2, ... for people.`);
  return ok({ ...output, picks, ...(compromises && { compromises }) });
}

/**
 * Checks the model's pick against the real offers and the group's limits, prices it, saves it for the group to
 * review, and returns what the model needs to tell them about it. A pick that does not hold up is sent back as an
 * error the model can fix on its next step; nothing is saved until it does.
 */
export async function proposePlan(env: ToolEnv, argumentsJson: string): Promise<string> {
  const { deps, run, session } = env;
  const trip = session.trip;
  if (trip === null || session.offersByAlias.size === 0) return problem("There are no search results yet. Call search_trip first.");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(argumentsJson);
  } catch {
    return problem("The arguments were not valid JSON.");
  }
  const parsed = parsePlannerOutput(parsedJson);
  if (!parsed.ok) return problem(parsed.error.message);
  const output = toRealIds(parsed.value, env);
  if (!output.ok) return problem(output.error);

  const people = members(env);
  const constraints = await env.constraints();
  const inputsHash = computeInputsHash({ trip, memberIds: people.map((member) => member.id), constraints, flyingMemberIds: session.flyerIds ?? undefined });
  const current = await deps.plans.latest(run.groupId);
  env.note("decision", { currentPlan: current ? { id: current.id, status: current.status, sameInputs: current.inputsHash === inputsHash } : null, inputsHash });

  const open = current && !FINISHED_STATUSES.includes(current.status) ? current : null;
  // A change request is a reason to replace the plan even when no limit changed (the person may be objecting to
  // something already on record). A plan made earlier in this same turn still counts as the answer to it.
  const replaceable = env.changeRequested && open !== null && session.planId !== open.id;
  if (open && open.inputsHash === inputsHash && !replaceable) {
    session.planId = open.id;
    return asJson({ alreadyExists: true, status: open.status, agreed: open.agreedCount, outOf: open.headcount, note: "Nothing has changed since this plan was made, so no new plan was created." });
  }
  if (open && LOCKED_STATUSES.includes(open.status)) return problem(MESSAGES.booking_started);

  // Looks at every paid or booking trip, not just the newest plan, so an earlier trip still holds its dates. The plan
  // being replaced is left out: if booking has just started on it, the swap below refuses with the right reason.
  const taken = (await deps.plans.committedTrips(run.groupId)).filter((committed) => committed.planId !== open?.id);
  const clash = findClash(trip, taken);
  if (clash) return problem(`These dates overlap "${clash.title}" (${clash.departDate} to ${clash.returnDate}), which is already paid for or being booked. Ask the group for dates that do not overlap it.`);

  const replacing = open ? open.id : null;
  const fx = await deps.fx.forCurrencies(env.group.baseCurrency, people.map((member) => member.currency));
  if (!fx.ok) return problem(MESSAGES.no_exchange_rate);

  const offers = [...session.offersByAlias.values()];
  const built = await buildPlan({
    planner: { proposePlan: async () => ok(output.value) },
    members: people.map((member) => ({ id: member.id, currency: member.currency })),
    constraints,
    offers,
    fx: fx.value,
    requiredKinds: REQUIRED_KINDS,
    flyingMemberIds: session.flyerIds ?? undefined,
    now: env.now,
    maxAttempts: 1,
  });
  if (!built.ok) return problem(built.error.message);
  const { plan, shares, violations } = built.value;
  if (violations.length > 0) {
    env.note("plan_refused", { violations: violations.map((violation) => violation.message) });
    return problem(unmetNeedsMessage(violations.map((violation) => nameMembers(violation.message, people))));
  }
  env.note("plan_built", { title: plan.title, totalMinor: plan.totalMinor, currency: plan.currency, picks: plan.picks.map((pick) => ({ offerId: pick.offer.id, kind: pick.offer.kind, members: pick.memberIds.map((id) => people.find((member) => member.id === id)?.displayName), reason: pick.reason })), shares, violations: violations.map((violation) => violation.message) });

  const deadlines = computePlanDeadlines({ createdAt: env.now, offers: plan.picks.map((pick) => pick.offer) });
  if (!deadlines.ok) return problem(MESSAGES.prices_expired);

  const brief = await deps.briefs.save({ groupId: run.groupId, fields: trip, headcount: people.length, openQuestions: [], runId: run.id });
  if (!brief.ok) return problem(MESSAGES.failed);
  const searchIds = await deps.searches.save(brief.value.id, session.searches, env.now);

  const suggestions = await suggestForFreeTime(env, plan, constraints, trip);
  const created = await deps.plans.create({
    groupId: run.groupId,
    briefId: brief.value.id,
    title: plan.title,
    summary: plan.summary ?? null,
    deadlineAt: deadlines.value.deadlineAt,
    hardDeadlineAt: deadlines.value.hardDeadlineAt,
    baseCurrency: env.group.baseCurrency,
    fx: fx.value,
    headcount: people.length,
    inputsHash,
    offersCheckedAt: env.now,
    recreatedFromPlanId: replacing,
    memberIds: people.map((member) => member.id),
    picks: plan.picks.map((pick) => ({ offer: pick.offer, searchId: searchIds.ok ? (searchIds.value.get(pick.offer.id) ?? null) : null, memberIds: pick.memberIds, reason: pick.reason, notes: pick.notes })),
    suggestions,
  });
  if (!created.ok) return problem(created.error.code === "conflict" ? MESSAGES.conflict : MESSAGES.failed);
  const planId = created.value;

  const started = await applyPlanEvent(deps.planRepository, planId, { type: "review_started", at: env.now });
  if (!started.ok) {
    await deps.plans.remove(planId);
    return problem(MESSAGES.failed);
  }
  if (replacing !== null) {
    const replaced = await replaceOldPlan(env, replacing, planId);
    if (!replaced.ok) {
      await deps.plans.remove(planId);
      return problem(replaced.error);
    }
  }

  session.planId = planId;
  const nameOf = new Map(people.map((member) => [member.id, member.displayName]));
  return asJson({
    planCreated: true,
    replacedEarlierPlan: replacing !== null,
    title: plan.title,
    total: formatMinor(plan.totalMinor, plan.currency),
    perPerson: shares.map((share) => ({ name: nameOf.get(share.memberId) ?? "Someone", share: formatMinor(share.shareMinor, share.currency) })),
    notFullyServed: violations.map((violation) => nameMembers(violation.message, people)),
    next: "The plan is now in front of the group. Everyone agrees to it, then each person approves their own amount. Nothing is charged until everyone is in.",
  });
}

/**
 * Expires the old plan so the new one takes over. The new plan is already saved, so if the old one cannot be
 * replaced (booking has started in the meantime) the new one is discarded and the group keeps what it had.
 */
async function replaceOldPlan(env: ToolEnv, oldPlanId: string, newPlanId: string): Promise<Result<void, string>> {
  const replaced = await applyPlanEvent(env.deps.planRepository, oldPlanId, { type: "plan_replaced", at: env.now });
  if (!replaced.ok) {
    if (replaced.error.kind === "transition") return err(replaced.error.error.code === "plan_closed" ? MESSAGES.trip_booked : MESSAGES.booking_started);
    return err(MESSAGES.conflict);
  }
  await env.deps.plans.markReplaced(oldPlanId, newPlanId);
  return ok(undefined);
}

/** Best effort: a plan is still worth showing if the free-time ideas could not be made or confirmed. */
async function suggestForFreeTime(env: ToolEnv, plan: ValidatedPlan, constraints: ConstraintSet, trip: CompleteTrip): Promise<readonly VerifiedSuggestion[]> {
  if (!env.deps.venues) return [];
  const schedule = buildSchedule(plan);
  if (!schedule.ok || schedule.value.gaps.length === 0) return [];
  const result = await suggestFreeTime({ planner: env.planner, lookup: env.deps.venues, gaps: schedule.value.gaps, memberIds: members(env).map((member) => member.id), constraints, city: trip.destinationCity, now: env.now });
  return result.ok ? result.value.verified : [];
}
