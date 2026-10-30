import type { Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { OfferSource } from "@/domain/offers/offer-source";
import type { PlanRepository } from "@/domain/plan/repository";
import type { Planner } from "@/domain/planner/planner";
import type { VenueLookup } from "@/domain/schedule/venue";
import type { SearchOptions } from "@/domain/trip/search";
import { AliasingPlanner } from "./aliasing-planner";
import { MESSAGES } from "./announce";
import { runConversation } from "./loop/conversation";
import type { ChatModel } from "./loop/model";
import { buildOpening, SYSTEM_PROMPT } from "./loop/prompt";
import { newSession, type RosterEntry, type ToolEnv } from "./loop/session";
import type { WebResearcher } from "./loop/research";
import { runTool, toolSpecsFor } from "./loop/tools";
import type { AgentRun, AgentRunRepository, BriefRepository, ConstraintRepository, FxRates, PlanStore, SearchStore, StartedRun, StoreError, UsageMeter, UsageTotals } from "./ports";
import type { TraceSink } from "./trace";

const CHAT_WINDOW = 200;
const READING_LABEL = "Reading the chat…";
const DEFAULT_STALE_RUN_MS = 5 * 60_000;
/** Every call costs real money, so one person, and one group, can only call the agent so often. */
export const RUN_LIMITS = {
  windowMs: 60 * 60_000,
  perMember: 10,
  perGroup: 30,
  /** A ceiling on the whole service, because every run costs real model calls and groups cost nothing to make. */
  everyone: { perHour: 100, perDay: 200 },
} as const;
const DAY_MS = 24 * 60 * 60_000;
export const AGENT_DISPLAY_NAME = "Trippy";

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
  /** Makes the planner for one run, wired to that run's usage meter. It reads people's limits and suggests free time. */
  readonly makePlanner: (meter: UsageMeter) => Planner;
  /** Makes the conversational model for one run, wired to that run's usage meter. */
  readonly makeChatModel: (meter: UsageMeter) => ChatModel;
  /** Makes the web researcher for one run, wired to that run's usage meter. Unset when web search is switched off. */
  readonly makeResearcher?: (meter: UsageMeter) => WebResearcher;
  /** Where the run writes what it did and why. Unset in production. */
  readonly trace?: TraceSink;
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
export async function startAgentRun(deps: Pick<AgentDeps, "runs" | "messages" | "clock" | "staleRunMs">, message: { readonly id: string; readonly groupId: string; readonly memberId: string | null }): Promise<Result<StartedRun, StoreError>> {
  const now = deps.clock();
  const recent = await deps.runs.countRecent(message.groupId, message.memberId, new Date(now.getTime() - RUN_LIMITS.windowMs));
  if (!recent.ok) return recent;
  const lastHour = await deps.runs.countAll(new Date(now.getTime() - RUN_LIMITS.windowMs));
  if (!lastHour.ok) return lastHour;
  const lastDay = await deps.runs.countAll(new Date(now.getTime() - DAY_MS));
  if (!lastDay.ok) return lastDay;
  const busy = lastHour.value >= RUN_LIMITS.everyone.perHour || lastDay.value >= RUN_LIMITS.everyone.perDay;
  if (busy || recent.value.member >= RUN_LIMITS.perMember || recent.value.group >= RUN_LIMITS.perGroup) {
    await deps.messages.postAgent(message.groupId, MESSAGES.limited, { replyToMessageId: message.id });
    return { ok: true, value: { status: "limited" } };
  }

  const started = await deps.runs.start({ groupId: message.groupId, triggerMessageId: message.id, requestedByMemberId: message.memberId, now, staleAfterMs: deps.staleRunMs ?? DEFAULT_STALE_RUN_MS });
  if (started.ok && started.value.status === "busy") await deps.messages.postAgent(message.groupId, MESSAGES.busy, { replyToMessageId: message.id });
  return started;
}

/**
 * Does one run of the agent: hands the chat to the model, which decides for itself whether to answer, ask or look
 * things up, and posts what it says. Never throws: whatever happens, the group hears about it and the run is
 * closed with what it cost.
 */
export async function runAgent(deps: AgentDeps, run: AgentRun): Promise<void> {
  const meter = createUsageMeter();
  let outcome: Outcome;
  try {
    outcome = await execute(deps, run, meter);
  } catch {
    await deps.messages.postAgent(run.groupId, MESSAGES.failed, { replyToMessageId: run.triggerMessageId });
    outcome = failed("unexpected");
  }
  deps.trace?.({ at: deps.clock().toISOString(), source: "agent", stage: "run_finished", data: { runId: run.id, outcome, usage: meter.totals() } });
  await deps.runs.finish(run.id, { status: outcome.status, usage: meter.totals(), errorCode: outcome.status === "failed" ? outcome.errorCode : undefined }, deps.clock());
}

async function execute(deps: AgentDeps, run: AgentRun, meter: UsageMeter): Promise<Outcome> {
  const now = deps.clock();
  const group = await deps.groups.find(run.groupId);
  if (!group.ok) return failed("group_missing");
  const people = await deps.groups.joinedMembers(run.groupId);
  if (people.length === 0) return failed("no_members");

  const roster: RosterEntry[] = people.map((member, index) => ({ alias: `m${index + 1}`, member }));
  const memberIds = people.map((member) => member.id);
  const nameOf = new Map(people.map((member) => [member.id, member.displayName]));
  const note = (stage: string, data: unknown): void => deps.trace?.({ at: deps.clock().toISOString(), source: "agent", stage, data: { runId: run.id, ...(data as object) } });

  const recent = await deps.messages.recent(run.groupId, CHAT_WINDOW);
  const humanChat = recent.filter((message) => message.kind === "human" && message.memberId !== null).map((message) => ({ memberId: message.memberId as string, text: message.body }));
  const chat = recent
    .filter((message) => message.kind === "human" || message.kind === "agent")
    .map((message) => ({ from: message.kind === "agent" ? AGENT_DISPLAY_NAME : (nameOf.get(message.memberId ?? "") ?? "Someone who left"), text: message.body }));
  const currentPlan = await deps.plans.latest(run.groupId);
  note("run_started", { triggerMessageId: run.triggerMessageId, today: now.toISOString().slice(0, 10), headcount: people.length, chat, currentPlan: currentPlan && { status: currentPlan.status, agreed: currentPlan.agreedCount } });

  const planner = new AliasingPlanner(deps.makePlanner(meter), people);
  // People's limits (budget, flight times, things to skip) are read in the background while the model talks.
  const limits = readConstraints(deps, planner, memberIds, humanChat, group.value.baseCurrency, note);

  const session = newSession();
  const researcher = deps.makeResearcher?.(meter) ?? null;
  const env: ToolEnv = { deps, run, group: group.value, roster, now, constraints: () => limits, planner, session, researcher, note };
  const say = async (text: string): Promise<void> => {
    await deps.messages.postAgent(run.groupId, text, { replyToMessageId: run.triggerMessageId, planId: session.planId !== null ? session.planId : undefined });
  };
  // Only what the bubble shows: a failure to record it must never stop the run.
  const progress = async (text: string): Promise<void> => {
    try {
      await deps.runs.setProgress(run.id, text);
    } catch {
      /* the bubble just keeps its last words */
    }
  };
  await progress(READING_LABEL);

  const end = await runConversation({
    model: deps.makeChatModel(meter),
    system: SYSTEM_PROMPT,
    opening: buildOpening({ today: now.toISOString().slice(0, 10), members: roster.map((entry) => ({ alias: entry.alias, name: entry.member.displayName })), currentPlan, chat }),
    tools: toolSpecsFor(researcher !== null),
    runTool: (name, argumentsJson) => runTool(env, name, argumentsJson),
    say,
    progress,
    note,
  });
  if (end.status === "replied") return done;

  // The plan was saved before the model stopped, so the group still gets its card.
  if (session.planId !== null) {
    await deps.messages.postAgent(run.groupId, MESSAGES.plan_ready, { replyToMessageId: run.triggerMessageId, planId: session.planId });
    return done;
  }
  await say(MESSAGES[end.code === "too_many_steps" ? "too_long" : end.code === "planner_unavailable" ? "planner_unavailable" : "invalid_output"]);
  return failed(end.code);
}

/** Never rejects: if the limits cannot be read, what is already known stays. */
async function readConstraints(deps: AgentDeps, planner: Planner, memberIds: readonly string[], messages: readonly { memberId: string; text: string }[], defaultCurrency: string, note: (stage: string, data: unknown) => void): Promise<ConstraintSet> {
  try {
    const read = await planner.extractConstraints({ memberIds, messages, defaultCurrency });
    note("constraints_read", read.ok ? { constraints: read.value } : { error: read.error });
    if (read.ok) await deps.constraints.save(read.value);
  } catch {
    note("constraints_read", { error: "unexpected failure" });
  }
  return deps.constraints.forMembers(memberIds);
}
