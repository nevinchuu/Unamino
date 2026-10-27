import { err, ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { MessageRepository } from "@/domain/group/repository";
import type { Group, Member, Message } from "@/domain/group/types";
import type { OfferSource } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import type { PlanRepository, RepositoryError, StoredPlan } from "@/domain/plan/repository";
import type { PlanStatus } from "@/domain/plan/statuses";
import type { MemberSnapshot, PlanSnapshot } from "@/domain/plan/types";
import type { PlannerError } from "@/domain/planner/errors";
import type { ExtractConstraintsInput, Planner, ProposePlanInput, SuggestFreeTimeInput } from "@/domain/planner/planner";
import type { PlannerOutput } from "@/domain/planner/schema";
import type { ChatModel, ModelRequest, ModelTurn } from "./loop/model";
import { BANGKOK_CONSTRAINTS, BANGKOK_OFFERS, NOW, pick } from "@/domain/planner/test-support";
import type { SuggestionOutput } from "@/domain/schedule/suggestion-schema";
import type { SearchRecord } from "@/domain/trip/search";
import type { AgentRun, AgentRunRepository, BriefRepository, CommittedTrip, ConstraintRepository, NewPlan, PlanStore, PlanSummary, RunOutcome, SearchStore, StartedRun, StoredBrief, StoreError, UsageMeter } from "./ports";
import { StaticFxRates } from "./static-fx";
import type { AgentDeps } from "./run-agent";

export { NOW };

export const GROUP: Group = { id: "g1", name: "Bangkok weekend", baseCurrency: "USD" };
const NAMES: Readonly<Record<string, string>> = { nevin: "Nevin", ana: "Ana", ben: "Ben", jia: "Jia", ravi: "Ravi" };
export const member = (id: string, currency = "USD"): Member => ({ id, groupId: GROUP.id, displayName: NAMES[id] ?? id, currency, isOrganiser: id === "nevin" });

/** The wireframe plan without its activities, because no source returns activities yet, so none can be picked. */
export const PLAN_FOR_FOUR: PlannerOutput = {
  title: "Bangkok weekend",
  picks: [pick("fx-flt-evening", ["nevin", "ana", "ben", "jia"]), pick("fx-htl-triple", ["nevin", "ana", "ben"]), pick("fx-htl-single", ["jia"])],
};

export const BANGKOK_TRIP = { destinationCity: "Bangkok", destinationCountry: "TH", destinationAirport: "BKK", originAirport: "SIN", departDate: "2026-12-11", returnDate: "2026-12-13" };

/** The model sees m1, m2, ... so scripted answers are written in those. This maps real ids to them, in group order. */
export const aliasOf = (ids: readonly string[]) => (id: string): string => `m${ids.indexOf(id) + 1}`;

export const planAs = (plan: PlannerOutput, ids: readonly string[]): PlannerOutput => {
  const alias = aliasOf(ids);
  return { ...plan, picks: plan.picks.map((p) => ({ ...p, members: p.members.map((m) => ({ ...m, memberId: alias(m.memberId) })) })), compromises: plan.compromises?.map((c) => ({ ...c, memberId: alias(c.memberId) })) };
};

export const constraintsAs = (set: ConstraintSet, ids: readonly string[]): ConstraintSet => Object.fromEntries(Object.entries(set).map(([id, value]) => [aliasOf(ids)(id), value]));

// ---- the model ----

export interface PlannerBehaviour {
  constraints?: (input: ExtractConstraintsInput) => Result<ConstraintSet, PlannerError>;
  plan?: (input: ProposePlanInput) => Result<PlannerOutput, PlannerError>;
  suggest?: (input: SuggestFreeTimeInput) => Result<SuggestionOutput, PlannerError>;
}

/** A planner that answers from functions and records every question it was asked, as the model would see them. */
export class RecordingPlanner implements Planner {
  readonly constraintCalls: ExtractConstraintsInput[] = [];
  readonly planCalls: ProposePlanInput[] = [];
  readonly suggestCalls: SuggestFreeTimeInput[] = [];

  constructor(
    private readonly behaviour: PlannerBehaviour,
    private readonly meter: UsageMeter,
  ) {}

  private bill(): void {
    this.meter.add({ promptTokens: 10, completionTokens: 20, reasoningTokens: 5 });
  }

  async extractConstraints(input: ExtractConstraintsInput): Promise<Result<ConstraintSet, PlannerError>> {
    this.constraintCalls.push(input);
    this.bill();
    return this.behaviour.constraints ? this.behaviour.constraints(input) : ok(constraintsAs(BANGKOK_CONSTRAINTS, ["nevin", "ana", "ben", "jia"]));
  }

  async proposePlan(input: ProposePlanInput): Promise<Result<PlannerOutput, PlannerError>> {
    this.planCalls.push(input);
    this.bill();
    return this.behaviour.plan ? this.behaviour.plan(input) : ok(planAs(PLAN_FOR_FOUR, ["nevin", "ana", "ben", "jia"]));
  }

  async suggestFreeTime(input: SuggestFreeTimeInput): Promise<Result<SuggestionOutput, PlannerError>> {
    this.suggestCalls.push(input);
    this.bill();
    return this.behaviour.suggest ? this.behaviour.suggest(input) : ok({ suggestions: [] });
  }
}

// ---- the conversational model ----

export type ChatStep = ModelTurn | Result<ModelTurn, PlannerError> | ((request: ModelRequest) => ModelTurn | Result<ModelTurn, PlannerError>);

const isResult = (value: ModelTurn | Result<ModelTurn, PlannerError>): value is Result<ModelTurn, PlannerError> => "ok" in value;

/** A chat model that follows a script: one step per turn, repeating the last. It records every request it was sent. */
export class ScriptedChatModel implements ChatModel {
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly steps: readonly ChatStep[],
    private readonly meter: UsageMeter,
  ) {}

  async turn(request: ModelRequest): Promise<Result<ModelTurn, PlannerError>> {
    // The loop keeps adding to its message list, so what this turn was sent is copied.
    this.requests.push({ ...request, messages: [...request.messages] });
    this.meter.add({ promptTokens: 10, completionTokens: 20, reasoningTokens: 5 });
    const step = this.steps[Math.min(this.requests.length, this.steps.length) - 1];
    if (step === undefined) return err({ code: "planner_unavailable", message: "The scripted model has no steps" });
    const answer = typeof step === "function" ? step(request) : step;
    return isResult(answer) ? answer : ok(answer);
  }
}

/** A turn that only talks. */
export const says = (text: string): ModelTurn => ({ text, toolCalls: [] });

/** A turn that uses a tool, optionally saying something to the group first. */
export const calls = (name: string, args: unknown, text: string | null = null, id = `call-${name}`): ModelTurn => ({ text, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

/** The JSON the last tool answered with, for a step that needs to pick from the search results. */
export function lastToolResult(request: ModelRequest): Record<string, unknown> {
  const message = [...request.messages].reverse().find((m) => m.role === "tool");
  return message && message.role === "tool" ? (JSON.parse(message.content) as Record<string, unknown>) : {};
}

export interface SearchResult {
  flights: { id: string; route: string; legs: string[] }[];
  hotels: { id: string; roomIsFor: number }[];
}

export const pickMember = (alias: string) => ({ memberId: alias, note: "Works for them" });

/** The model's choice from whatever the search showed: the evening flight, a triple for three and a single for one. */
export function proposeFrom(request: ModelRequest, people: readonly string[] = ["nevin", "ana", "ben", "jia"], flightAt = "20:10"): ReturnType<typeof calls> {
  const found = lastToolResult(request) as unknown as SearchResult;
  const everyone = people.map((_, index) => `m${index + 1}`);
  const flight = found.flights.find((f) => f.legs.some((leg) => leg.includes(flightAt))) as { id: string };
  const singles = found.hotels.filter((hotel) => hotel.roomIsFor === 1);
  const picks =
    people.length === 4
      ? [
          { offerId: flight.id, reason: "Leaves after 6pm", members: everyone.map(pickMember) },
          { offerId: (found.hotels.find((h) => h.roomIsFor === 3) as { id: string }).id, reason: "Shared room for three", members: everyone.slice(0, 3).map(pickMember) },
          { offerId: singles[0].id, reason: "Jia's own room", members: [pickMember("m4")] },
        ]
      : [
          { offerId: flight.id, reason: "One flight for all five", members: everyone.map(pickMember) },
          { offerId: (found.hotels.find((h) => h.roomIsFor === 3) as { id: string }).id, reason: "Shared room for three", members: everyone.slice(0, 3).map(pickMember) },
          { offerId: singles[0].id, reason: "Jia's own room", members: [pickMember("m4")] },
          { offerId: singles[1].id, reason: "Ravi's own room", members: [pickMember("m5")] },
        ];
  return calls("propose_plan", { title: "Bangkok weekend", picks });
}

export const search = (text: string | null = "Checking flights and hotels...") => calls("search_trip", BANGKOK_TRIP, text);
export const planTurns = (final: string): ChatStep[] => [search(), (request) => proposeFrom(request), says(final)];

// ---- storage in memory ----

export class FakeGroups {
  constructor(public members: Member[]) {}
  async find() { return ok(GROUP); }
  async joinedMembers(): Promise<readonly Member[]> { return this.members; }
}

export class FakeMessages implements MessageRepository {
  readonly all: Message[] = [];
  private seq = 0;

  private push(kind: Message["kind"], groupId: string, body: string, extra: Partial<Message> = {}): Message {
    this.seq += 1;
    const message: Message = { id: `msg-${this.seq}`, seq: this.seq, groupId, memberId: null, kind, body, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: NOW, ...extra };
    this.all.push(message);
    return message;
  }

  human(memberId: string, body: string): Message {
    return this.push("human", GROUP.id, body, { memberId, mentionsAgent: /@trippy/i.test(body) });
  }

  async post() { return err({ code: "unavailable" as const, message: "not used" }); }
  async postAgent(groupId: string, body: string, options: { replyToMessageId?: string; planId?: string } = {}) { return ok(this.push("agent", groupId, body, { replyToMessageId: options.replyToMessageId ?? null, planId: options.planId ?? null })); }
  async postSystem(groupId: string, body: string) { return ok(this.push("system", groupId, body)); }
  async listAfter(groupId: string, afterSeq: number, limit: number) { return this.all.filter((m) => m.groupId === groupId && m.seq > afterSeq).slice(0, limit); }
  async recent(groupId: string, limit: number) { return this.all.filter((m) => m.groupId === groupId).slice(-limit); }

  get agentMessages(): Message[] { return this.all.filter((m) => m.kind === "agent"); }
  get lastAgentBody(): string { return this.agentMessages.at(-1)?.body ?? ""; }
}

export class FakeRuns implements AgentRunRepository {
  running: AgentRun | null = null;
  readonly started: AgentRun[] = [];
  readonly finished: { runId: string; outcome: RunOutcome }[] = [];
  private readonly triggers = new Set<string>();

  async start(input: { groupId: string; triggerMessageId: string }): Promise<Result<StartedRun, StoreError>> {
    if (this.triggers.has(input.triggerMessageId)) return ok({ status: "duplicate" });
    if (this.running) return ok({ status: "busy" });
    this.triggers.add(input.triggerMessageId);
    const run: AgentRun = { id: `run-${this.started.length + 1}`, groupId: input.groupId, triggerMessageId: input.triggerMessageId };
    this.running = run;
    this.started.push(run);
    return ok({ status: "started", run });
  }

  async finish(runId: string, outcome: RunOutcome): Promise<void> {
    this.finished.push({ runId, outcome });
    this.running = null;
  }

  async isRunning(): Promise<boolean> {
    return this.running !== null;
  }
}

export class FakeBriefs implements BriefRepository {
  readonly versions: (StoredBrief & { openQuestions: readonly string[] })[] = [];
  async latest(): Promise<StoredBrief | null> { return this.versions.at(-1) ?? null; }
  async save(input: Parameters<BriefRepository["save"]>[0]): Promise<Result<StoredBrief, StoreError>> {
    const stored = { id: `brief-${this.versions.length + 1}`, version: this.versions.length + 1, fields: input.fields, headcount: input.headcount, openQuestions: input.openQuestions };
    this.versions.push(stored);
    return ok(stored);
  }
}

export class FakeConstraints implements ConstraintRepository {
  readonly stored = new Map<string, ConstraintSet[string]>();
  async forMembers(ids: readonly string[]): Promise<ConstraintSet> { return Object.fromEntries(ids.filter((id) => this.stored.has(id)).map((id) => [id, this.stored.get(id) as ConstraintSet[string]])); }
  async save(set: ConstraintSet): Promise<void> { for (const [id, value] of Object.entries(set)) this.stored.set(id, value); }
}

export class FakeSearches implements SearchStore {
  readonly saved: { briefId: string; searches: readonly SearchRecord[] }[] = [];
  async save(briefId: string, searches: readonly SearchRecord[]): Promise<Result<ReadonlyMap<string, string>, StoreError>> {
    this.saved.push({ briefId, searches });
    const ids = new Map<string, string>();
    searches.forEach((search, index) => search.offers.forEach((offer) => { if (!ids.has(offer.id)) ids.set(offer.id, `search-${this.saved.length}-${index}`); }));
    return ok(ids);
  }
}

interface StoredPlanRecord {
  readonly id: string;
  readonly input: NewPlan;
  version: number;
  snapshot: PlanSnapshot;
  replacedBy: string | null;
}

const freshMember = (id: string): MemberSnapshot => ({ id, planAgreement: "pending", agreedShareMinor: null, approval: "pending", approvedMinor: null, currentShareMinor: null, chargedMinor: null, approvalExpiresAt: null, holdPlaced: false });

/** Holds plans for the agent and for the state machine, as the real database does for both. */
export class FakePlans implements PlanStore, PlanRepository {
  readonly records: StoredPlanRecord[] = [];
  /** Makes `latest` report a different state from the real one, to simulate booking starting in between. */
  summaryStatusOverride: PlanStatus | null = null;

  constructor(private readonly briefs: FakeBriefs) {}

  async committedTrips(): Promise<readonly CommittedTrip[]> {
    return this.records.flatMap((record) => {
      const { departDate, returnDate } = this.briefs.versions.find((brief) => brief.id === record.input.briefId)?.fields ?? {};
      const committed = ["booking", "booked", "captured"].includes(record.snapshot.status);
      return committed && departDate && returnDate ? [{ planId: record.id, title: record.input.title, departDate, returnDate }] : [];
    });
  }

  async latest(): Promise<PlanSummary | null> {
    const record = this.records.at(-1);
    if (!record) return null;
    return { id: record.id, title: record.input.title, status: this.summaryStatusOverride ?? record.snapshot.status, inputsHash: record.input.inputsHash, headcount: record.input.headcount, agreedCount: record.snapshot.members.filter((m) => m.planAgreement === "agreed").length };
  }

  async create(plan: NewPlan): Promise<Result<string, StoreError>> {
    if (plan.recreatedFromPlanId && this.records.some((r) => r.input.recreatedFromPlanId === plan.recreatedFromPlanId)) return err({ code: "conflict", message: "already replaced" });
    const id = `plan-${this.records.length + 1}`;
    this.records.push({ id, input: plan, version: 1, replacedBy: null, snapshot: { status: "draft", deadlineAt: plan.deadlineAt, hardDeadlineAt: plan.hardDeadlineAt, members: plan.memberIds.map(freshMember) } });
    return ok(id);
  }

  async remove(planId: string): Promise<void> {
    const index = this.records.findIndex((r) => r.id === planId);
    if (index >= 0) this.records.splice(index, 1);
  }

  async markReplaced(oldPlanId: string, newPlanId: string): Promise<void> {
    const record = this.records.find((r) => r.id === oldPlanId);
    if (record) record.replacedBy = newPlanId;
  }

  async load(planId: string): Promise<Result<StoredPlan, RepositoryError>> {
    const record = this.records.find((r) => r.id === planId);
    return record ? ok({ id: record.id, version: record.version, plan: record.snapshot }) : err({ code: "not_found", message: "no plan" });
  }

  async save(stored: StoredPlan, next: PlanSnapshot): Promise<Result<StoredPlan, RepositoryError>> {
    const record = this.records.find((r) => r.id === stored.id);
    if (!record) return err({ code: "not_found", message: "no plan" });
    if (record.version !== stored.version) return err({ code: "version_conflict", message: "changed" });
    record.version += 1;
    record.snapshot = next;
    return ok({ id: record.id, version: record.version, plan: next });
  }

  force(planId: string, status: PlanStatus): void {
    const record = this.records.find((r) => r.id === planId);
    if (record) record.snapshot = { ...record.snapshot, status };
  }

  statusOf(planId: string): PlanStatus | undefined { return this.records.find((r) => r.id === planId)?.snapshot.status; }
}

/** Finds offers by kind, whatever the query, from a list the test can change. */
export class FakeOfferSource implements OfferSource {
  readonly queries: Parameters<OfferSource["search"]>[0][] = [];
  failWith: { code: "source_unavailable"; message: string } | null = null;
  /** Kinds whose searches fail while the others succeed. */
  failKinds = new Set<string>();
  constructor(public offers: readonly Offer[] = BANGKOK_OFFERS) {}
  async search(query: Parameters<OfferSource["search"]>[0]) {
    this.queries.push(query);
    if (this.failWith || this.failKinds.has(query.kind)) return err(this.failWith ?? { code: "source_unavailable" as const, message: `${query.kind} search is down` });
    return ok(this.offers.filter((offer) => offer.kind === query.kind));
  }
}

export interface World {
  readonly deps: AgentDeps;
  readonly groups: FakeGroups;
  readonly messages: FakeMessages;
  readonly runs: FakeRuns;
  readonly briefs: FakeBriefs;
  readonly constraints: FakeConstraints;
  readonly searches: FakeSearches;
  readonly plans: FakePlans;
  readonly source: FakeOfferSource;
  readonly planners: RecordingPlanner[];
  readonly planner: () => RecordingPlanner;
  /** What the model does on each turn of the next run. */
  readonly script: (...steps: ChatStep[]) => void;
  readonly models: ScriptedChatModel[];
  readonly model: () => ScriptedChatModel;
}

/** A group of four, empty storage, and a model that gives the answers the wireframe trip expects unless told otherwise. */
export function buildWorld(behaviour: PlannerBehaviour = {}, people: readonly Member[] = ["nevin", "ana", "ben", "jia"].map((id) => member(id))): World {
  const groups = new FakeGroups([...people]);
  const messages = new FakeMessages();
  const runs = new FakeRuns();
  const briefs = new FakeBriefs();
  const constraints = new FakeConstraints();
  const searches = new FakeSearches();
  const plans = new FakePlans(briefs);
  const source = new FakeOfferSource();
  const planners: RecordingPlanner[] = [];
  const models: ScriptedChatModel[] = [];
  let steps: ChatStep[] = [];
  const deps: AgentDeps = {
    groups, messages, runs, briefs, constraints, searches, plans, planRepository: plans, offers: source, venues: null,
    fx: new StaticFxRates(),
    makePlanner: (meter) => { const planner = new RecordingPlanner(behaviour, meter); planners.push(planner); return planner; },
    makeChatModel: (meter) => { const model = new ScriptedChatModel(steps, meter); models.push(model); return model; },
    clock: () => NOW,
    searchOptions: { retryDelayMs: 0 },
  };
  return { deps, groups, messages, runs, briefs, constraints, searches, plans, source, planners, planner: () => planners[planners.length - 1], script: (...next) => { steps = next; }, models, model: () => models[models.length - 1] };
}
