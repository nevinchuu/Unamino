import type { Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { Offer } from "@/domain/offers/schema";
import type { PlanStatus } from "@/domain/plan/statuses";
import type { VerifiedSuggestion } from "@/domain/schedule/verify-suggestion";
import type { FxRateTable } from "@/domain/split/types";
import type { TripFields } from "@/domain/trip/brief-schema";
import type { SearchRecord } from "@/domain/trip/search";

export interface StoreError {
  readonly code: "unavailable" | "conflict";
  readonly message: string;
}

export interface UsageTotals {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Part of the completion tokens, billed as output. */
  readonly reasoningTokens: number;
}

/** Adds up what the model calls of one run cost. */
export interface UsageMeter {
  add(usage: { readonly promptTokens: number; readonly completionTokens: number; readonly reasoningTokens: number }): void;
  totals(): UsageTotals;
}

export interface AgentRun {
  readonly id: string;
  readonly groupId: string;
  readonly triggerMessageId: string;
}

/** "busy": the group already has a run going. "duplicate": this message was already handled. "limited": too many calls lately. */
export type StartedRun = { readonly status: "started"; readonly run: AgentRun } | { readonly status: "busy" } | { readonly status: "duplicate" } | { readonly status: "limited" };

/** How many runs a group, and one person in it, have started since a moment. */
export interface RecentRuns {
  readonly group: number;
  readonly member: number;
}

export interface RunOutcome {
  readonly status: "done" | "failed";
  readonly usage: UsageTotals;
  readonly model?: string;
  readonly errorCode?: string;
}

export interface AgentRunRepository {
  /** Starts a run unless the group already has one going. A run left going for longer than `staleAfterMs` is written off first. */
  start(input: { groupId: string; triggerMessageId: string; requestedByMemberId: string | null; now: Date; staleAfterMs: number }): Promise<Result<StartedRun, StoreError>>;
  finish(runId: string, outcome: RunOutcome, now: Date): Promise<void>;
  /** How many runs the group, and this person in it, started since `since`. Every run counts, whatever it came to. */
  countRecent(groupId: string, memberId: string | null, since: Date): Promise<Result<RecentRuns, StoreError>>;
  /** Is the agent working for this group right now? A run left going for longer than `staleAfterMs` no longer counts. */
  isRunning(groupId: string, now: Date, staleAfterMs: number): Promise<boolean>;
}

export interface StoredBrief {
  readonly id: string;
  readonly version: number;
  readonly fields: TripFields;
  readonly headcount: number;
}

export interface BriefRepository {
  latest(groupId: string): Promise<StoredBrief | null>;
  /** Writes the next version of the group's brief. */
  save(input: { groupId: string; fields: TripFields; headcount: number; openQuestions: readonly string[]; runId: string }): Promise<Result<StoredBrief, StoreError>>;
}

export interface ConstraintRepository {
  forMembers(memberIds: readonly string[]): Promise<ConstraintSet>;
  /** Replaces what is known for each member named, and leaves everyone else alone. */
  save(constraints: ConstraintSet): Promise<void>;
}

export interface SearchStore {
  /** Keeps every search and every offer it found. Returns which search found each offer, by offer id. */
  save(briefId: string, searches: readonly SearchRecord[], fetchedAt: Date): Promise<Result<ReadonlyMap<string, string>, StoreError>>;
}

export interface PlanSummary {
  readonly id: string;
  readonly title: string;
  readonly status: PlanStatus;
  readonly inputsHash: string;
  readonly headcount: number;
  /** How many people have agreed to the plan so far. */
  readonly agreedCount: number;
}

/** What a plan card in the chat shows about one of the group's plans. */
export interface PlanCardSummary {
  readonly id: string;
  readonly title: string;
  readonly status: PlanStatus;
  readonly headcount: number;
  readonly agreedCount: number;
  readonly replacedById: string | null;
}

/** A trip the group has paid for or is paying for now. Its dates are taken, so a new plan cannot overlap them. */
export interface CommittedTrip {
  readonly planId: string;
  readonly title: string;
  readonly departDate: string;
  readonly returnDate: string;
}

export interface NewPlan {
  readonly groupId: string;
  readonly briefId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly deadlineAt: Date;
  readonly hardDeadlineAt: Date;
  readonly baseCurrency: string;
  readonly fx: FxRateTable;
  readonly headcount: number;
  readonly inputsHash: string;
  readonly offersCheckedAt: Date;
  /** The plan this one replaces, if any. A plan can be replaced only once. */
  readonly recreatedFromPlanId: string | null;
  readonly memberIds: readonly string[];
  readonly picks: readonly NewPick[];
  readonly suggestions: readonly VerifiedSuggestion[];
}

export interface NewPick {
  readonly offer: Offer;
  readonly searchId: string | null;
  readonly memberIds: readonly string[];
  readonly reason: string;
  readonly notes: Readonly<Record<string, string>>;
}

export interface PlanStore {
  /** The group's newest plan, whatever state it is in. */
  latest(groupId: string): Promise<PlanSummary | null>;
  /** Every plan the group has made, oldest first, each with its own state, for the cards in the chat. */
  cards(groupId: string): Promise<readonly PlanCardSummary[]>;
  /** The group's trips that are being booked or already paid for, whichever plan is newest. */
  committedTrips(groupId: string): Promise<readonly CommittedTrip[]>;
  /** Saves a plan, its people, its picks and its suggestions together, as a draft. */
  create(plan: NewPlan): Promise<Result<string, StoreError>>;
  /** Undoes `create`, for a plan that could not take over from the old one. */
  remove(planId: string): Promise<void>;
  markReplaced(oldPlanId: string, newPlanId: string): Promise<void>;
}

/** Exchange rates for the currencies in a group. Real rates are not wired in yet. */
export interface FxRates {
  forCurrencies(baseCurrency: string, currencies: readonly string[]): Promise<Result<FxRateTable, StoreError>>;
}
