import "server-only";
import { after } from "next/server";
import type { AgentDeps } from "@/domain/agent/run-agent";
import { StaticFxRates } from "@/domain/agent/static-fx";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { OfferSource } from "@/domain/offers/offer-source";
import { SupplierBookingRunner } from "@/domain/booking/booking-runner";
import { BookingSweeper } from "@/domain/booking/sweeper";
import { EffectRetrier, giveUpLine } from "@/domain/payments/effect-retrier";
import { ProviderHoldReadiness } from "@/domain/payments/hold-readiness";
import { HoldService } from "@/domain/payments/hold-service";
import type { HoldStore } from "@/domain/payments/hold-store";
import { PaymentEffectRunner } from "@/domain/payments/payment-effects";
import type { PaymentsMode } from "@/domain/payments/types";
import { ChatEffectRunner } from "@/domain/plan/chat-effects";
import { CompositeEffectRunner, type EffectRunner } from "@/domain/plan/effects";
import { PlanService } from "@/domain/plan/service";
import { SimulatedBookingRunner } from "@/domain/plan/simulated-booking";
import { SimulatedHoldRunner } from "@/domain/plan/simulated-holds";
import type { PlanStatusReader } from "@/domain/plan/status-reader";
import type { PlanViewStore } from "@/domain/plan/view-store";
import { TravellerCleanupRunner } from "@/domain/travellers/cleanup-runner";
import { TravellerService } from "@/domain/travellers/service";
import { connectDatabase } from "@/infrastructure/db/client";
import { PostgresBriefRepository } from "@/infrastructure/db/postgres-brief-repository";
import { PostgresConstraintRepository } from "@/infrastructure/db/postgres-constraint-repository";
import { PostgresEffectLog } from "@/infrastructure/db/postgres-effect-log";
import { PostgresEffectRecorder } from "@/infrastructure/db/postgres-effect-recorder";
import { PostgresGroupRepository } from "@/infrastructure/db/postgres-group-repository";
import { PostgresHoldStore } from "@/infrastructure/db/postgres-hold-store";
import { PostgresMessageRepository } from "@/infrastructure/db/postgres-message-repository";
import { PostgresPlanDetailsStore } from "@/infrastructure/db/postgres-plan-details-store";
import { PostgresPlanRepository } from "@/infrastructure/db/postgres-plan-repository";
import { PostgresPlanStatusReader } from "@/infrastructure/db/postgres-plan-status-reader";
import { PostgresPlanStore } from "@/infrastructure/db/postgres-plan-store";
import { PostgresPlanViewStore } from "@/infrastructure/db/postgres-plan-view-store";
import { PostgresReadMarkers } from "@/infrastructure/db/postgres-read-markers";
import { PostgresRunRepository } from "@/infrastructure/db/postgres-run-repository";
import { PostgresSearchStore } from "@/infrastructure/db/postgres-search-store";
import { PostgresBookingStore } from "@/infrastructure/db/postgres-booking-store";
import { PostgresTravellerStore } from "@/infrastructure/db/postgres-traveller-store";
import { AesGcmCipher } from "@/infrastructure/crypto/aes-gcm-cipher";
import { GooglePlacesLookup } from "@/infrastructure/google-places/places-lookup";
import { LiteApiBookingHttp } from "@/infrastructure/liteapi/booking-http";
import { LiteApiFlightSupplier } from "@/infrastructure/liteapi/flight-booking";
import { LiteApiHotelSupplier } from "@/infrastructure/liteapi/hotel-booking";
import { LiteApiOfferSource } from "@/infrastructure/liteapi/liteapi-offer-source";
import { MuseHttp, type MuseCall } from "@/infrastructure/muse/muse-http";
import { MusePlanner } from "@/infrastructure/muse/muse-planner";
import { MuseChatModel } from "@/infrastructure/muse/muse-chat-model";
import { MuseResearcher } from "@/infrastructure/muse/muse-researcher";
import { traceSinkFromEnv } from "@/infrastructure/trace/file-trace";
import { createStripeClient } from "@/infrastructure/stripe/stripe-client";
import { StripePaymentProvider } from "@/infrastructure/stripe/stripe-provider";
import { DeferredBookingRunner } from "./deferred-runner";
import { ViewerCards } from "./viewer-card";
import type { GroupCounter } from "./group-rate";
import type { ChatDeps } from "./chat";
import type { TripsDeps } from "./trips";
import type { StripeEventLike } from "./stripe-webhook";
import { readServerEnv, resolveBookingSimulation, resolveHoldSimulation, resolvePaymentsMode } from "./env";
import { GROUP_CURRENCY } from "./group-currency";

/** A flight search can take several seconds, and slower when run alongside the hotel searches. */
const OFFER_TIMEOUT_MS = 45_000;
/** A serverless function opens its own connections, so each keeps few. */
const MAX_CONNECTIONS = 5;

export interface Container {
  readonly groups: GroupRepository;
  /** For limiting how many groups the service makes. */
  readonly groupCounter: GroupCounter;
  readonly messages: MessageRepository;
  readonly agent: AgentDeps;
  /** What the chat screen and its polling read. */
  readonly chat: ChatDeps;
  /** What the trips list reads. */
  readonly trips: TripsDeps;
  readonly plans: PlanService;
  readonly planStatus: PlanStatusReader;
  /** What the plan screen reads. */
  readonly views: PlanViewStore;
  /** How money is handled, and what the card form and Stripe's webhook need when it is real. */
  readonly payments: {
    readonly mode: PaymentsMode;
    /** True when booking is only pretended, so the screen says so. */
    readonly demoBooking: boolean;
    /** Null unless holds are real. */
    readonly holds: HoldService | null;
    readonly holdStore: HoldStore;
    /** Does again what failed to move money. Null unless holds are real. */
    readonly retrier: EffectRetrier | null;
    readonly webhook: { readonly secret: string | null; readonly verify: (body: string, signature: string, secret: string) => StripeEventLike } | null;
  };
  /** Null when there is no encryption key, in which case details cannot be taken. */
  readonly travellers: TravellerService | null;
  /** Null unless bookings are made for real. Settles bookings that got stuck. */
  readonly bookingSweeper: BookingSweeper | null;
  readonly offers: OfferSource;
  readonly cronSecret: string | null;
}

/** How many times a charge is tried right away after the trip is booked. */
const CAPTURE_ATTEMPTS = 3;

function build(): Container {
  const env = readServerEnv(process.env);
  // A server missing its keys cannot do anything useful, so this stops the request with a plain message (names only).
  if (!env.ok) throw new Error(`Server is not configured. Missing: ${env.error.missing.join(", ") || "MUSE_SPARK_API_KEY"}`);

  // Asking to pretend card holds in production stops the server, rather than letting people "pay" without paying.
  const simulation = resolveHoldSimulation(env.value.simulateHolds, process.env.NODE_ENV);
  if (!simulation.ok) throw new Error(simulation.error.message);

  // The same for pretending a booking succeeded, which would charge people for a trip that was never booked.
  const bookingSimulation = resolveBookingSimulation(env.value.simulateBooking, process.env.NODE_ENV);
  if (!bookingSimulation.ok) throw new Error(bookingSimulation.error.message);

  const { db } = connectDatabase(env.value.databaseUrl, MAX_CONNECTIONS, { caCertificate: env.value.databaseCaCertificate, requireVerification: process.env.NODE_ENV === "production" });
  const groups = new PostgresGroupRepository(db);
  const messages = new PostgresMessageRepository(db);
  const planRepository = new PostgresPlanRepository(db);
  const offers = new LiteApiOfferSource({ apiKey: env.value.liteApiKey, currency: GROUP_CURRENCY, guestNationality: "SG", timeoutMs: OFFER_TIMEOUT_MS });

  const trace = traceSinkFromEnv(process.env);
  const onTrace = trace && ((call: MuseCall) => trace({ at: new Date().toISOString(), source: "muse", stage: call.task, data: call }));

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
    makePlanner: (meter) => new MusePlanner(new MuseHttp({ ...env.value.muse, onUsage: (usage) => meter.add(usage), onTrace })),
    makeChatModel: (meter) => new MuseChatModel(new MuseHttp({ ...env.value.muse, onUsage: (usage) => meter.add(usage), onTrace })),
    ...(env.value.webSearch && { makeResearcher: (meter) => new MuseResearcher(new MuseHttp({ ...env.value.muse, onUsage: (usage) => meter.add(usage), onTrace })) }),
    trace,
    clock: () => new Date(),
  };

  const views = new PostgresPlanViewStore(db);
  const reads = new PostgresReadMarkers(db);

  // A key that is present but wrong stops the server: running without it would quietly refuse every traveller.
  let travellers: TravellerService | null = null;
  if (env.value.travellerEncryptionKey) {
    const cipher = AesGcmCipher.fromBase64Key(env.value.travellerEncryptionKey);
    if (!cipher.ok) throw new Error(`TRAVELLER_ENCRYPTION_KEY is not valid: ${cipher.error}`);
    travellers = new TravellerService({ store: new PostgresTravellerStore(db), cipher: cipher.value, clock: agent.clock });
  }

  const mode = resolvePaymentsMode({ simulateHolds: simulation.value, stripeSecretKey: env.value.stripeSecretKey });
  const viewerCards = new ViewerCards({ views, payments: mode, clock: agent.clock });

  // What follows a change to a plan: it is written down, the group is told in the chat, and the money moves:
  // for real on Stripe when there is a key, or pretended in development when asked for.
  const runners: EffectRunner[] = [
    new PostgresEffectRecorder(db),
    new ChatEffectRunner({
      groupIdOf: (planId) => views.groupIdOf(planId),
      memberNames: (groupId) => groups.memberNames(groupId),
      messages,
      demoBooking: bookingSimulation.value,
    }),
  ];
  // Passport details go as soon as they have done their job: when the trip is booked, or when the plan ends.
  if (travellers) runners.push(new TravellerCleanupRunner(travellers));
  const effects = new CompositeEffectRunner(runners);
  const planService = new PlanService({ plans: planRepository, details: new PostgresPlanDetailsStore(db), source: offers, effects });
  // Both of these pass on what the last hold sets in motion (booking), so they need the whole set, themselves included.
  if (mode === "demo") runners.push(new SimulatedHoldRunner(planRepository, () => effects, agent.clock));
  if (bookingSimulation.value) runners.push(new SimulatedBookingRunner(planRepository, () => effects, agent.clock));

  const holdStore = new PostgresHoldStore(db);
  let holds: HoldService | null = null;
  let retrier: EffectRetrier | null = null;
  let bookingSweeper: BookingSweeper | null = null;
  let webhook: Container["payments"]["webhook"] = null;
  if (mode === "stripe" && env.value.stripeSecretKey) {
    const stripe = createStripeClient(env.value.stripeSecretKey);
    const provider = new StripePaymentProvider(stripe);
    holds = new HoldService({ provider, store: holdStore, plans: planRepository, effects: () => effects, clock: agent.clock });
    const log = new PostgresEffectLog(db);
    // The trip is already booked when the charges are taken, so a charge that fails for a moment is tried again right away.
    const paymentRunner = new PaymentEffectRunner(holds, log, { captureAttempts: CAPTURE_ATTEMPTS });
    runners.push(paymentRunner);
    // Real booking with the airline and hotel needs the travellers' details, so without the encryption key the plan waits at "held".
    if (!bookingSimulation.value && travellers) {
      const bookingHttp = new LiteApiBookingHttp({ apiKey: env.value.liteApiKey });
      const bookingStore = new PostgresBookingStore(db);
      const booking = new SupplierBookingRunner({
        plans: planRepository,
        details: new PostgresPlanDetailsStore(db),
        travellers,
        holds: new ProviderHoldReadiness(holdStore, provider),
        hotels: new LiteApiHotelSupplier(bookingHttp),
        flights: new LiteApiFlightSupplier(bookingHttp),
        bookings: bookingStore,
        onward: () => effects,
        clock: agent.clock,
        renew: async (planId) => {
          await planService.refresh(planId, agent.clock());
        },
        announce: async (planId, line) => {
          const group = await views.groupIdOf(planId);
          if (group.ok && group.value) await messages.postSystem(group.value, line);
        },
      });
      bookingSweeper = new BookingSweeper(bookingStore, booking, agent.clock);
      // The last card hold is placed inside a request; booking takes far longer than a person should wait.
      runners.push(new DeferredBookingRunner(booking, (task) => after(task)));
    }
    retrier = new EffectRetrier({
      log,
      runner: paymentRunner,
      clock: agent.clock,
      onGaveUp: async (planId, effect) => {
        const line = giveUpLine(effect);
        const group = await views.groupIdOf(planId);
        if (line && group.ok && group.value) await messages.postSystem(group.value, line);
      },
    });
    webhook = { secret: env.value.stripeWebhookSecret, verify: (body, signature, secret) => stripe.webhooks.constructEvent(body, signature, secret) as unknown as StripeEventLike };
  }

  return {
    groups,
    groupCounter: groups,
    messages,
    agent,
    chat: { groups, messages, runs: agent.runs, plans: agent.plans, viewerCards, reads, clock: agent.clock },
    trips: { groups, messages, plans: agent.plans, viewerCards, reads },
    plans: planService,
    planStatus: new PostgresPlanStatusReader(db),
    views,
    payments: { mode, demoBooking: bookingSimulation.value, holds, holdStore, retrier, webhook },
    travellers,
    bookingSweeper,
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
