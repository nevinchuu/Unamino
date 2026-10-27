import type { Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { Offer, OfferKind } from "@/domain/offers/schema";
import type { SuggestionOutput } from "@/domain/schedule/suggestion-schema";
import type { TripBriefOutput, TripFields } from "@/domain/trip/brief-schema";
import type { FreeGap } from "@/domain/schedule/types";
import type { PlannerError } from "./errors";
import type { PlannerOutput } from "./schema";

export interface ChatMessage {
  readonly memberId: string;
  readonly text: string;
}

export interface ExtractConstraintsInput {
  readonly memberIds: readonly string[];
  readonly messages: readonly ChatMessage[];
  /** What a bare amount such as "$350" means. Without it, a budget with no stated currency cannot be read. */
  readonly defaultCurrency?: string;
}

export interface ExtractTripBriefInput {
  readonly memberIds: readonly string[];
  readonly messages: readonly ChatMessage[];
  /** Today's date, "YYYY-MM-DD", so "Fri 11 Dec" and "next month" can be turned into real dates. */
  readonly today: string;
  /** What the group had already settled, so a later message changes only what it mentions. */
  readonly previous?: TripFields;
}

export interface ProposePlanInput {
  readonly memberIds: readonly string[];
  readonly constraints: ConstraintSet;
  /** The only offers the planner may pick from. */
  readonly offers: readonly Offer[];
  /** Kinds every member must have at least one of, so the planner knows what a complete plan needs. */
  readonly requiredKinds?: readonly OfferKind[];
  /** What was wrong with the previous attempt, in plain words, so the next one can fix it. */
  readonly feedback: readonly string[];
}

export interface SuggestFreeTimeInput {
  readonly city: string;
  readonly memberIds: readonly string[];
  readonly constraints: ConstraintSet;
  /** The only time the planner may fill. */
  readonly gaps: readonly FreeGap[];
  /** Why earlier suggestions were rejected, so the next ones can avoid the same mistakes. */
  readonly feedback: readonly string[];
}

/** The AI side of planning. The Meta Muse client implements this; tests use a scripted one. */
export interface Planner {
  extractConstraints(input: ExtractConstraintsInput): Promise<Result<ConstraintSet, PlannerError>>;
  /** Reads the chat for where and when, and says what is still unclear. */
  extractTripBrief(input: ExtractTripBriefInput): Promise<Result<TripBriefOutput, PlannerError>>;
  proposePlan(input: ProposePlanInput): Promise<Result<PlannerOutput, PlannerError>>;
  suggestFreeTime(input: SuggestFreeTimeInput): Promise<Result<SuggestionOutput, PlannerError>>;
}
