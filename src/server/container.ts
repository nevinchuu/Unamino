import type { AgentDeps } from "@/domain/agent/run-agent";
import { StaticFxRates } from "@/domain/agent/static-fx";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { OfferSource } from "@/domain/offers/offer-source";
import { ChatEffectRunner } from "@/domain/plan/chat-effects";
import { CompositeEffectRunner, type EffectRunner } from "@/domain/plan/effects";
import { PlanService } from "@/domain/plan/service";
import { SimulatedHoldRunner } from "@/domain/plan/simulated-holds";
import type { PlanStatusReader } from "@/domain/plan/status-reader";
import type { PlanViewStore } from "@/domain/plan/view-store";
import { connectDatabase } from "@/infrastructure/db/client";
import { PostgresBriefRepository } from "@/infrastructure/db/postgres-brief-repository";
import { PostgresConstraintRepository } from "@/infrastructure/db/postgres-constraint-repository";
import { PostgresEffectRecorder } from "@/infrastructure/db/postgres-effect-recorder";
import { PostgresGroupRepository } from "@/infrastructure/db/postgres-group-repository";
import { PostgresMessageRepository } from "@/infrastructure/db/postgres-message-repository";
import { PostgresPlanDetailsStore } from "@/infrastructure/db/postgres-plan-details-store";
import { PostgresPlanRepository } from "@/infrastructure/db/postgres-plan-repository";
import { PostgresPlanStatusReader } from "@/infrastructure/db/postgres-plan-status-reader";
import { PostgresPlanStore } from "@/infrastructure/db/postgres-plan-store";
import { PostgresPlanViewStore } from "@/infrastructure/db/postgres-plan-view-store";
import { PostgresRunRepository } from "@/infrastructure/db/postgres-run-repository";
import { PostgresSearchStore } from "@/infrastructure/db/postgres-search-store";
import { GooglePlacesLookup } from "@/infrastructure/google-places/places-lookup";
import { LiteApiOfferSource } from "@/infrastructure/liteapi/liteapi-offer-source";
import { MuseHttp } from "@/infrastructure/muse/muse-http";
import { MusePlanner } from "@/infrastructure/muse/muse-planner";
import type { ChatDeps } from "./chat";
import { readServerEnv, resolveHoldSimulation } from "./env";
import { GROUP_CURRENCY } from "./group-currency";

/** A flight search can take several seconds, and slower when run alongside the hotel searches. */
const OFFER_TIMEOUT_MS = 45_000;
/** A serverless function opens its own connections, so each keeps few. */
const MAX_CONNECTIONS = 5;

export interface Container {
  readonly groups: GroupRepository;
  readonly messages: MessageRepository;
  readonly agent: AgentDeps;
  /** What the chat screen and its polling read. */
  readonly chat: ChatDeps;
  readonly plans: PlanService;
  readonly planStatus: PlanStatusReader;
  /** What the plan screen reads. */
  readonly views: PlanViewStore;
  /** True when card holds are pretended (development only), so the screen says so. */
  readonly demoHolds: boolean;
  readonly offers: OfferSource;
  readonly cronSecret: string | null;
}

function build(): Container {
  const env = readServerEnv(process.env);
  // A server missing its keys cannot do anything useful, so this stops the request with a plain message (names only).
  if (!env.ok) throw new Error(`Server is not configured. Missing: ${env.error.missing.join(", ") || "MUSE_SPARK_API_KEY"}`);

  // Asking to pretend card holds in production stops the server, rather than letting people "pay" without paying.
  const simulation = resolveHoldSimulation(env.value.simulateHolds, process.env.NODE_ENV);
  if (!simulation.ok) throw new Error(simulation.error.message);

  const { db } = connectDatabase(env.value.databaseUrl, MAX_CONNECTIONS);
  const groups = new PostgresGroupRepository(db);
  const messages = new PostgresMessageRepository(db);
  const planRepository = new PostgresPlanRepository(db);
  const offers = new LiteApiOfferSource({ apiKey: env.value.liteApiKey, currency: GROUP_CURRENCY, guestNationality: "SG", timeoutMs: OFFER_TIMEOUT_MS });

  const agent: AgentDeps = {
    groups,
    messages,
    runs: new PostgresRunRepository(db),
    briefs: new PostgresBriefRepository(db),
    constraints: new PostgresConstraintRepository(db),
    searches: new PostgresSearchStore(db),
    plans: new PostgresPlanStore(db),
    planRepository,
    offers,
    venues: env.value.placesApiKey ? new GooglePlacesLookup({ apiKey: env.value.placesApiKey }) : null,
    fx: new StaticFxRates(),
    makePlanner: (meter) => new MusePlanner(new MuseHttp({ ...env.value.muse, onUsage: (usage) => meter.add(usage) })),
    clock: () => new Date(),
  };

  const views = new PostgresPlanViewStore(db);

  // What follows a change to a plan: it is written down, the group is told in the chat, and in development the card hold can be pretended.
  const runners: EffectRunner[] = [
    new PostgresEffectRecorder(db),
    new ChatEffectRunner({
      groupIdOf: (planId) => views.groupIdOf(planId),
      memberNames: (groupId) => groups.memberNames(groupId),
      messages,
    }),
  ];
  const effects = new CompositeEffectRunner(runners);
  // The simulated hold passes on what the last hold sets in motion, so it needs the whole set, itself included.
  if (simulation.value) runners.push(new SimulatedHoldRunner(planRepository, () => effects, agent.clock));

  return {
    groups,
    messages,
    agent,
    chat: { groups, messages, runs: agent.runs, plans: agent.plans, clock: agent.clock },
    plans: new PlanService({ plans: planRepository, details: new PostgresPlanDetailsStore(db), source: offers, effects }),
    planStatus: new PostgresPlanStatusReader(db),
    views,
    demoHolds: simulation.value,
    offers,
    cronSecret: env.value.cronSecret,
  };
}

// Kept on globalThis so hot reload in development reuses the same connections instead of opening more each time.
const holder = globalThis as typeof globalThis & { __unaminoContainer?: Container };

/** The one set of wired-up services for this server process. Built on first use. */
export function getContainer(): Container {
  holder.__unaminoContainer ??= build();
  return holder.__unaminoContainer;
}
