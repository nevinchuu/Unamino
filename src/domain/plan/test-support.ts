import { err, ok, type Result } from "@/lib/result";
import type { OfferQuery, OfferSource, OfferSourceError } from "@/domain/offers/offer-source";
import type { FlightOffer, HotelOffer, Offer } from "@/domain/offers/schema";
import type { Cover } from "@/domain/split/types";
import type { CoverStore } from "./cover-store";
import type { PlanDetails, PlanDetailsStore, RenewedPick } from "./details-store";
import { effectKey, type EffectError, type EffectRunner } from "./effects";
import type { RefreshDeps } from "./refresh";
import type { PlanRepository, RepositoryError, StoredPlan } from "./repository";
import type { PlanStatus } from "./statuses";
import type { MemberSnapshot, PlanEffect, PlanSnapshot } from "./types";

/** A plan store in memory that enforces the same version rule as the real one. */
export class MemoryPlanRepository implements PlanRepository {
  /** Saves that went through. */
  saves = 0;
  loads = 0;
  /** Every save asked for, whether or not it went through. */
  saveAttempts = 0;
  /** Runs before each save, to simulate someone else saving first. */
  beforeSave: (repo: MemoryPlanRepository, attempt: number) => void = () => undefined;
  /** When set, every save fails with this. */
  saveFailure: RepositoryError | null = null;
  constructor(public stored: StoredPlan) {}

  async load(): Promise<Result<StoredPlan, RepositoryError>> {
    this.loads += 1;
    return ok(this.stored);
  }

  async save(stored: StoredPlan, next: PlanSnapshot): Promise<Result<StoredPlan, RepositoryError>> {
    this.saveAttempts += 1;
    this.beforeSave(this, this.saveAttempts);
    if (this.saveFailure) return err(this.saveFailure);
    if (this.stored.version !== stored.version) return err({ code: "version_conflict", message: "changed" });
    this.saves += 1;
    this.stored = { id: stored.id, version: stored.version + 1, plan: next };
    return ok(this.stored);
  }

  get plan(): PlanSnapshot {
    return this.stored.plan;
  }
}

/** The details of a plan in memory, with the same cooldown rule as the real store. */
export class MemoryDetailsStore implements PlanDetailsStore {
  claims = 0;
  renewals: (readonly RenewedPick[])[] = [];
  /** The plans `listPastDeadline` reports. */
  pastDeadline: string[] = [];
  constructor(public details: PlanDetails) {}

  async load(): Promise<Result<PlanDetails, RepositoryError>> {
    return ok(this.details);
  }

  async claimRefresh(_planId: string, now: Date, cooldownMs: number): Promise<Result<boolean, RepositoryError>> {
    const last = this.details.offersCheckedAt;
    if (last && last.getTime() > now.getTime() - cooldownMs) return ok(false);
    this.claims += 1;
    this.details = { ...this.details, offersCheckedAt: now };
    return ok(true);
  }

  async saveRenewal(_planId: string, renewed: readonly RenewedPick[]): Promise<Result<void, RepositoryError>> {
    this.renewals.push(renewed);
    const offerByPick = new Map(renewed.map((pick) => [pick.pickId, pick.offer]));
    this.details = { ...this.details, picks: this.details.picks.map((pick) => ({ ...pick, offer: offerByPick.get(pick.id) ?? pick.offer })) };
    return ok(undefined);
  }

  async listPastDeadline(): Promise<Result<readonly string[], RepositoryError>> {
    return ok(this.pastDeadline);
  }
}

/** The covers of a plan in memory. It also keeps the plan's details in step, because pricing reads covers from there. */
export class MemoryCoverStore implements CoverStore {
  constructor(private readonly details: MemoryDetailsStore, public saveFailure: RepositoryError | null = null) {}

  async list(): Promise<Result<readonly Cover[], RepositoryError>> {
    return ok(this.details.details.covers);
  }

  async save(_planId: string, cover: Cover): Promise<Result<void, RepositoryError>> {
    if (this.saveFailure) return err(this.saveFailure);
    const kept = this.details.details.covers.filter((entry) => !(entry.sponsorId === cover.sponsorId && entry.beneficiaryId === cover.beneficiaryId));
    const index = this.details.details.covers.findIndex((entry) => entry.sponsorId === cover.sponsorId && entry.beneficiaryId === cover.beneficiaryId);
    const covers = index === -1 ? [...kept, cover] : [...kept.slice(0, index), cover, ...kept.slice(index)];
    this.details.details = { ...this.details.details, covers };
    return ok(undefined);
  }

  async remove(_planId: string, sponsorId: string, beneficiaryId: string): Promise<Result<void, RepositoryError>> {
    const covers = this.details.details.covers.filter((entry) => !(entry.sponsorId === sponsorId && entry.beneficiaryId === beneficiaryId));
    this.details.details = { ...this.details.details, covers };
    return ok(undefined);
  }
}

/** Remembers the effects it was given, once per name like the real one, and can be made to fail. */
export class MemoryEffectRunner implements EffectRunner {
  readonly ran = new Map<string, PlanEffect>();
  failWith: EffectError | null = null;

  async run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    if (this.failWith) return err(this.failWith);
    effects.forEach((effect, index) => this.ran.set(effectKey(planId, version, index), effect));
    return ok(undefined);
  }

  get types(): string[] {
    return [...this.ran.values()].map((effect) => effect.type);
  }
}

/** Remembers every request it was given, and can be made to fail. */
export class RecordingEffectRunner implements EffectRunner {
  readonly calls: { planId: string; version: number; effects: readonly PlanEffect[] }[] = [];
  constructor(private readonly failure: EffectError | null = null) {}

  async run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    this.calls.push({ planId, version, effects });
    return this.failure ? err(this.failure) : ok(undefined);
  }
}

/** An offer source that answers each query from a function and remembers what it was asked. */
export class ScriptedSource implements OfferSource {
  readonly queries: OfferQuery[] = [];
  constructor(private readonly answer: (query: OfferQuery) => Result<readonly Offer[], OfferSourceError>) {}

  async search(query: OfferQuery): Promise<Result<readonly Offer[], OfferSourceError>> {
    this.queries.push(query);
    return this.answer(query);
  }
}

export const memberSnapshot = (id: string, overrides: Partial<MemberSnapshot> = {}): MemberSnapshot => ({
  id,
  planAgreement: "pending",
  agreedShareMinor: null,
  approval: "pending",
  approvedMinor: null,
  currentShareMinor: null,
  chargedMinor: null,
  approvalExpiresAt: null,
  holdPlaced: false,
  ...overrides,
});

// A two-member plan with a hotel and a flight, as it stands one refresh before the tests change the world.

export const NOW = new Date("2026-10-27T01:00:00.000Z");
export const minutesAfter = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);
export const DEADLINE = minutesAfter(2);
export const HARD = minutesAfter(48 * 60);

export const HOTEL_QUERY: OfferQuery = { kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-11", checkOut: "2026-12-13", guests: 2 };
export const FLIGHT_QUERY: OfferQuery = { kind: "flight", city: "Bangkok", origin: "SIN", destination: "BKK", departDate: "2026-12-11", returnDate: "2026-12-13", guests: 2 };

export const hotel = (overrides: Partial<HotelOffer> = {}): HotelOffer => ({
  kind: "hotel", id: "hotel-offer-1", listingId: "hotel-room-1", title: "Riverside Hotel", provider: "test", city: "Bangkok", currency: "USD",
  totalMinor: 40_000, guests: 2, checkIn: "2026-12-11", checkOut: "2026-12-13", roomName: "Twin", expiresAt: minutesAfter(2).toISOString(), ...overrides,
});

export const flight = (overrides: Partial<FlightOffer> = {}): FlightOffer => ({
  kind: "flight", id: "flight-offer-1", listingId: "SIN-BKK-1", title: "SIN to BKK", provider: "test", city: "Bangkok", currency: "USD",
  totalMinor: 20_000, guests: 2, refundable: false, expiresAt: minutesAfter(2).toISOString(),
  legs: [{ origin: "SIN", destination: "BKK", departAt: "2026-12-11T20:10:00", arriveAt: "2026-12-11T21:35:00", carrier: "Scoot", direction: "outbound" }], ...overrides,
});

/** What the searches return now. Each test changes it to say what happened to the offers since the plan was made. */
export interface World {
  hotels: Offer[];
  flights: Offer[];
}

export interface SetupOptions {
  status?: PlanStatus;
  members?: MemberSnapshot[];
  hardDeadlineAt?: Date;
  world?: Partial<World>;
  offersCheckedAt?: Date | null;
  hotelSearchId?: string | null;
}

export function setup(options: SetupOptions = {}) {
  const members = options.members ?? [memberSnapshot("ana"), memberSnapshot("ben")];
  const plan: PlanSnapshot = { status: options.status ?? "reviewing", deadlineAt: DEADLINE, hardDeadlineAt: options.hardDeadlineAt ?? HARD, members };
  const world: World = {
    hotels: [hotel({ id: "hotel-offer-2", expiresAt: minutesAfter(9).toISOString() })],
    flights: [flight({ id: "flight-offer-2", expiresAt: minutesAfter(9).toISOString() })],
    ...options.world,
  };
  const everyone = members.map((member) => member.id);
  const plans = new MemoryPlanRepository({ id: "plan-1", version: 1, plan });
  const details = new MemoryDetailsStore({
    planId: "plan-1",
    baseCurrency: "USD",
    fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} },
    offersCheckedAt: options.offersCheckedAt ?? null,
    covers: [],
    members: everyone.map((id) => ({ id, currency: "USD" })),
    picks: [
      { id: "pick-hotel", offer: hotel(), searchId: options.hotelSearchId === undefined ? "search-hotel" : options.hotelSearchId, memberIds: everyone },
      { id: "pick-flight", offer: flight(), searchId: "search-flight", memberIds: everyone },
    ],
    queries: new Map<string, OfferQuery>([["search-hotel", HOTEL_QUERY], ["search-flight", FLIGHT_QUERY]]),
  });
  const source = new ScriptedSource((query) => ok(query.kind === "hotel" ? world.hotels : world.flights));
  const effects = new MemoryEffectRunner();
  const deps: RefreshDeps = { plans, details, source, search: { retryDelayMs: 0 } };
  return { world, plans, details, source, effects, deps };
}

export const agreed = (id: string): MemberSnapshot => memberSnapshot(id, { planAgreement: "agreed", agreedShareMinor: 30_000 });
export const approved = (id: string, extra: Partial<MemberSnapshot> = {}): MemberSnapshot =>
  memberSnapshot(id, { planAgreement: "agreed", agreedShareMinor: 30_000, approval: "approved", approvedMinor: 30_000, currentShareMinor: 30_000, approvalExpiresAt: DEADLINE, ...extra });

