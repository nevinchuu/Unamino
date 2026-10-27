import { err, ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { Group, Member } from "@/domain/group/types";
import type { OfferSource } from "@/domain/offers/offer-source";
import { applyPlanEvent } from "@/domain/plan/apply-event";
import { computePlanDeadlines } from "@/domain/plan/deadline";
import type { PlanRepository } from "@/domain/plan/repository";
import type { PlannerError } from "@/domain/planner/errors";
import { buildPlan } from "@/domain/planner/build-plan";
import type { Planner } from "@/domain/planner/planner";
import { prefilterOffers } from "@/domain/planner/prefilter";
import type { ValidatedPlan } from "@/domain/planner/validate";
import { buildSchedule } from "@/domain/schedule/build-schedule";
import { suggestFreeTime } from "@/domain/schedule/suggest-free-time";
import type { VenueLookup } from "@/domain/schedule/venue";
import type { VerifiedSuggestion } from "@/domain/schedule/verify-suggestion";
import { assessTripBrief, mergeTripFields, type CompleteTrip } from "@/domain/trip/brief";
import type { TripFields } from "@/domain/trip/brief-schema";
import { searchForTrip, type SearchOptions } from "@/domain/trip/search";
import { AliasingPlanner } from "./aliasing-planner";
import { MESSAGES, nothingFound, planAnnouncement, questionsMessage, searchIncomplete, statusMessage } from "./announce";
import { computeInputsHash } from "./inputs-hash";
import type { AgentRun, AgentRunRepository, BriefRepository, ConstraintRepository, FxRates, PlanStore, SearchStore, StartedRun, StoredBrief, StoreError, UsageMeter, UsageTotals } from "./ports";

const CHAT_WINDOW = 200;
const DEFAULT_STALE_RUN_MS = 5 * 60_000;
const REQUIRED_KINDS = ["flight", "hotel"] as const;
/** Once booking has started, a plan can no longer be changed. */
const LOCKED_STATUSES = ["booking", "booked", "captured"] as const;

export interface AgentDeps {
  readonly groups: Pick<GroupRepository, "find" | "joinedMembers">;
  readonly messages: MessageRepository;
  readonly runs: AgentRunRepository;
  readonly briefs: BriefRepository;
  readonly constraints: ConstraintRepository;
  readonly searches: SearchStore;
  readonly plans: PlanStore;
  readonly planRepository: PlanRepository;
  readonly offers: OfferSource;
  /** Without one, no free-time suggestions are made. */
  readonly venues: VenueLookup | null;
  readonly fx: FxRates;
  /** Makes the planner for one run, wired to that run's usage meter. */
  readonly makePlanner: (meter: UsageMeter) => Planner;
  readonly clock: () => Date;
  readonly staleRunMs?: number;
  /** How failed searches are retried. Tests turn the pause off. */
  readonly searchOptions?: SearchOptions;
}

type Outcome = { readonly status: "done" } | { readonly status: "failed"; readonly errorCode: string };

const done: Outcome = { status: "done" };
const failed = (errorCode: string): Outcome => ({ status: "failed", errorCode });

export function createUsageMeter(): UsageMeter {
  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  return {
    add(usage) {
      calls += 1;
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
      reasoningTokens += usage.reasoningTokens;
    },
    totals: (): UsageTotals => ({ calls, promptTokens, completionTokens, reasoningTokens }),
  };
}

/**
 * Called when a message that calls the agent has been posted. Starts a run unless the group already has one going,
 * in which case the person is told so instead of a second run starting. The caller then runs it in the background.
 */
export async function startAgentRun(deps: AgentDeps, message: { readonly id: string; readonly groupId: string; readonly memberId: string | null }): Promise<Result<StartedRun, StoreError>> {
  const started = await deps.runs.start({ groupId: message.groupId, triggerMessageId: message.id, requestedByMemberId: message.memberId, now: deps.clock(), staleAfterMs: deps.staleRunMs ?? DEFAULT_STALE_RUN_MS });
  if (started.ok && started.value.status === "busy") await deps.messages.postAgent(message.groupId, MESSAGES.busy, { replyToMessageId: message.id });
  return started;
}

/** Everything one run needs, gathered once. */
interface Context {
  readonly deps: AgentDeps;
  readonly run: AgentRun;
  readonly planner: Planner;
  readonly group: Group;
  readonly members: readonly Member[];
  readonly now: Date;
}

/**
 * Does one run of the agent: reads the chat, asks what is unclear, and when the trip is known and something has
 * changed, searches, plans and swaps the new plan in. Never throws: whatever happens, the group hears about it and
 * the run is closed with what it cost.
 */
export async function runAgent(deps: AgentDeps, run: AgentRun): Promise<void> {
  const meter = createUsageMeter();
  let outcome: Outcome;
  try {
    outcome = await execute(deps, run, meter);
  } catch {
    await say(deps, run, MESSAGES.failed);
    outcome = failed("unexpected");
  }
  await deps.runs.finish(run.id, { status: outcome.status, usage: meter.totals(), errorCode: outcome.status === "failed" ? outcome.errorCode : undefined }, deps.clock());
}

const say = (deps: AgentDeps, run: AgentRun, text: string, planId?: string) => deps.messages.postAgent(run.groupId, text, { replyToMessageId: run.triggerMessageId, planId });

function plannerFailure(error: PlannerError): { readonly text: string; readonly code: string } {
  return error.code === "planner_unavailable" ? { text: MESSAGES.planner_unavailable, code: "planner_unavailable" } : { text: MESSAGES.invalid_output, code: "invalid_output" };
}

async function execute(deps: AgentDeps, run: AgentRun, meter: UsageMeter): Promise<Outcome> {
  const now = deps.clock();
  const group = await deps.groups.find(run.groupId);
  if (!group.ok) return failed("group_missing");
  const members = await deps.groups.joinedMembers(run.groupId);
  if (members.length === 0) return failed("no_members");

  const memberIds = members.map((member) => member.id);
  const ctx: Context = { deps, run, group: group.value, members, now, planner: new AliasingPlanner(deps.makePlanner(meter), memberIds) };

  const chat = (await deps.messages.recent(run.groupId, CHAT_WINDOW)).filter((message) => message.kind === "human" && message.memberId !== null).map((message) => ({ memberId: message.memberId as string, text: message.body }));
  const latestBrief = await deps.briefs.latest(run.groupId);

  const [briefRead, constraintRead] = await Promise.all([
    ctx.planner.extractTripBrief({ memberIds, messages: chat, today: now.toISOString().slice(0, 10), previous: latestBrief?.fields }),
    ctx.planner.extractConstraints({ memberIds, messages: chat, defaultCurrency: ctx.group.baseCurrency }),
  ]);
  if (!briefRead.ok) {
    const { text, code } = plannerFailure(briefRead.error);
    await say(deps, run, text);
    return failed(code);
  }
  if (!constraintRead.ok && constraintRead.error.code === "planner_unavailable") {
    await say(deps, run, MESSAGES.planner_unavailable);
    return failed("planner_unavailable");
  }
  // A reading that could not be understood leaves what is already known in place.
  if (constraintRead.ok) await deps.constraints.save(constraintRead.value);
  const constraints = await deps.constraints.forMembers(memberIds);

  const merged = mergeTripFields(latestBrief?.fields, briefRead.value.fields);
  const assessment = assessTripBrief({ fields: merged, modelQuestions: briefRead.value.questions, today: now.toISOString().slice(0, 10) });
  const changed = latestBrief === null || !sameFields(latestBrief.fields, merged) || latestBrief.headcount !== members.length;

  let brief: StoredBrief | null = latestBrief;
  if (changed) {
    const saved = await deps.briefs.save({ groupId: run.groupId, fields: merged, headcount: members.length, openQuestions: assessment.status === "incomplete" ? assessment.questions : [], runId: run.id });
    if (!saved.ok) return failed("brief_not_saved");
    brief = saved.value;
  }

  if (assessment.status === "incomplete") {
    await say(deps, run, questionsMessage(assessment.questions));
    return done;
  }
  if (brief === null) return failed("brief_missing");
  return planIfChanged(ctx, brief, assessment.trip, constraints);
}

const FIELD_KEYS = ["destinationCity", "destinationCountry", "destinationAirport", "originAirport", "departDate", "returnDate"] as const;
const sameFields = (a: TripFields, b: TripFields): boolean => FIELD_KEYS.every((key) => a[key] === b[key]);

/** The trip is known. If nothing has changed since the group's plan was made, say so; otherwise make a new one. */
async function planIfChanged(ctx: Context, brief: StoredBrief, trip: CompleteTrip, constraints: ConstraintSet): Promise<Outcome> {
  const { deps, run, members } = ctx;
  const inputsHash = computeInputsHash({ trip, memberIds: members.map((member) => member.id), constraints });
  const current = await deps.plans.latest(run.groupId);

  if (current && current.status !== "expired" && current.inputsHash === inputsHash) {
    await say(deps, run, statusMessage(current.status, current.agreedCount, current.headcount));
    return done;
  }
  // Once booking has started the plan is fixed, so there is no point searching for a replacement.
  if (current && (LOCKED_STATUSES as readonly string[]).includes(current.status)) {
    await say(deps, run, current.status === "captured" ? MESSAGES.trip_booked : MESSAGES.booking_started);
    return done;
  }
  return buildAndSwapIn(ctx, brief, trip, constraints, inputsHash, current && current.status !== "expired" ? current.id : null);
}

async function buildAndSwapIn(ctx: Context, brief: StoredBrief, trip: CompleteTrip, constraints: ConstraintSet, inputsHash: string, replacingPlanId: string | null): Promise<Outcome> {
  const { deps, run, members, group, now, planner } = ctx;

  const fx = await deps.fx.forCurrencies(group.baseCurrency, members.map((member) => member.currency));
  if (!fx.ok) {
    await say(deps, run, MESSAGES.no_exchange_rate);
    return failed("no_exchange_rate");
  }

  const searched = await searchForTrip(deps.offers, trip, members.length, deps.searchOptions);
  if (!searched.ok) {
    await say(deps, run, MESSAGES.search_unavailable);
    return failed("search_unavailable");
  }
  // A plan needs a flight and a hotel. If one is missing, say why instead of asking the model to plan without it.
  const missingKinds = REQUIRED_KINDS.filter((kind) => !searched.value.offers.some((offer) => offer.kind === kind));
  if (missingKinds.length > 0) {
    const searchFailed = searched.value.failures.some((failure) => (missingKinds as readonly string[]).includes(failure.query.kind));
    await say(deps, run, searchFailed ? searchIncomplete(missingKinds) : nothingFound(missingKinds));
    return failed(searchFailed ? "search_incomplete" : "nothing_found");
  }
  const saved = await deps.searches.save(brief.id, searched.value.searches, now);
  const searchIds = saved.ok ? saved.value : new Map<string, string>();

  const kept = prefilterOffers({ offers: searched.value.offers, constraints, now });
  const built = await buildPlan({ planner, members: members.map((member) => ({ id: member.id, currency: member.currency })), constraints, offers: kept.offers, fx: fx.value, requiredKinds: REQUIRED_KINDS, now });
  if (!built.ok) {
    const unavailable = built.error.code === "planner_unavailable";
    await say(deps, run, unavailable ? MESSAGES.planner_unavailable : MESSAGES.no_valid_plan);
    return failed(built.error.code);
  }
  const { plan, shares, violations } = built.value;

  const deadlines = computePlanDeadlines({ createdAt: now, offers: plan.picks.map((pick) => pick.offer) });
  if (!deadlines.ok) {
    await say(deps, run, MESSAGES.prices_expired);
    return failed("prices_expired");
  }

  const suggestions = await suggestForFreeTime(ctx, plan, constraints, trip);
  const created = await deps.plans.create({
    groupId: run.groupId,
    briefId: brief.id,
    title: plan.title,
    summary: plan.summary ?? null,
    deadlineAt: deadlines.value.deadlineAt,
    hardDeadlineAt: deadlines.value.hardDeadlineAt,
    baseCurrency: group.baseCurrency,
    fx: fx.value,
    headcount: members.length,
    inputsHash,
    offersCheckedAt: now,
    recreatedFromPlanId: replacingPlanId,
    memberIds: members.map((member) => member.id),
    picks: plan.picks.map((pick) => ({ offer: pick.offer, searchId: searchIds.get(pick.offer.id) ?? null, memberIds: pick.memberIds, reason: pick.reason, notes: pick.notes })),
    suggestions,
  });
  if (!created.ok) {
    await say(deps, run, created.error.code === "conflict" ? MESSAGES.conflict : MESSAGES.failed);
    return failed(created.error.code === "conflict" ? "plan_conflict" : "plan_not_saved");
  }
  const planId = created.value;

  const started = await applyPlanEvent(deps.planRepository, planId, { type: "review_started", at: now });
  if (!started.ok) {
    await deps.plans.remove(planId);
    await say(deps, run, MESSAGES.failed);
    return failed("review_not_started");
  }

  if (replacingPlanId !== null) {
    const replaced = await replaceOldPlan(ctx, replacingPlanId, planId);
    if (!replaced.ok) {
      await deps.plans.remove(planId);
      await say(deps, run, replaced.error);
      return failed("replace_refused");
    }
  }

  await say(deps, run, planAnnouncement({ trip, members, shares, totalMinor: plan.totalMinor, currency: plan.currency, violations, replacedAnotherPlan: replacingPlanId !== null }), planId);
  return done;
}

/**
 * Expires the old plan so the new one takes over. The new plan is already saved, so if the old one cannot be
 * replaced (booking has started in the meantime) the new one is discarded and the group keeps what it had.
 */
async function replaceOldPlan(ctx: Context, oldPlanId: string, newPlanId: string): Promise<Result<void, string>> {
  const { deps, now } = ctx;
  const replaced = await applyPlanEvent(deps.planRepository, oldPlanId, { type: "plan_replaced", at: now });
  if (!replaced.ok) {
    if (replaced.error.kind === "transition") return err(replaced.error.error.code === "plan_closed" ? MESSAGES.trip_booked : MESSAGES.booking_started);
    return err(MESSAGES.conflict);
  }
  // Any card holds the old plan had are released by the payment step, which does not exist yet; none are ever placed today.
  await deps.plans.markReplaced(oldPlanId, newPlanId);
  return ok(undefined);
}

/** Best effort: a plan is still worth showing if the free-time ideas could not be made or confirmed. */
async function suggestForFreeTime(ctx: Context, plan: ValidatedPlan, constraints: ConstraintSet, trip: CompleteTrip): Promise<readonly VerifiedSuggestion[]> {
  const { deps, planner, members, now } = ctx;
  if (!deps.venues) return [];
  const schedule = buildSchedule(plan);
  if (!schedule.ok || schedule.value.gaps.length === 0) return [];
  const result = await suggestFreeTime({ planner, lookup: deps.venues, gaps: schedule.value.gaps, memberIds: members.map((member) => member.id), constraints, city: trip.destinationCity, now });
  return result.ok ? result.value.verified : [];
}
