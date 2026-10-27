import type { AgentDeps } from "@/domain/agent/run-agent";
import { StaticFxRates } from "@/domain/agent/static-fx";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { OfferSource } from "@/domain/offers/offer-source";
import { PlanService } from "@/domain/plan/service";
import type { PlanStatusReader } from "@/domain/plan/status-reader";
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
import { PostgresRunRepository } from "@/infrastructure/db/postgres-run-repository";
import { PostgresSearchStore } from "@/infrastructure/db/postgres-search-store";
import { GooglePlacesLookup } from "@/infrastructure/google-places/places-lookup";
import { LiteApiOfferSource } from "@/infrastructure/liteapi/liteapi-offer-source";
import { MuseHttp } from "@/infrastructure/muse/muse-http";
import { MusePlanner } from "@/infrastructure/muse/muse-planner";
import { readServerEnv } from "./env";
import { GROUP_CURRENCY } from "./group-currency";

/** A flight search can take several seconds, and slower when run alongside the hotel searches. */
const OFFER_TIMEOUT_MS = 45_000;
/** A serverless function opens its own connections, so each keeps few. */
const MAX_CONNECTIONS = 5;

export interface Container {
  readonly groups: GroupRepository;
  readonly messages: MessageRepository;
  readonly agent: AgentDeps;
  readonly plans: PlanService;
  readonly planStatus: PlanStatusReader;
  readonly offers: OfferSource;
  readonly cronSecret: string | null;
}

function build(): Container {
  const env = readServerEnv(process.env);
  // A server missing its keys cannot do anything useful, so this stops the request with a plain message (names only).
  if (!env.ok) throw new Error(`Server is not configured. Missing: ${env.error.missing.join(", ") || "MUSE_SPARK_API_KEY"}`);

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

  return {
    groups,
    messages,
    agent,
    plans: new PlanService({ plans: planRepository, details: new PostgresPlanDetailsStore(db), source: offers, effects: new PostgresEffectRecorder(db) }),
    planStatus: new PostgresPlanStatusReader(db),
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
