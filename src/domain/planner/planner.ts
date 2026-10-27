import type { Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { Offer } from "@/domain/offers/schema";
import type { SuggestionOutput } from "@/domain/schedule/suggestion-schema";
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
}

export interface ProposePlanInput {
  readonly memberIds: readonly string[];
  readonly constraints: ConstraintSet;
  /** The only offers the planner may pick from. */
  readonly offers: readonly Offer[];
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
  proposePlan(input: ProposePlanInput): Promise<Result<PlannerOutput, PlannerError>>;
  suggestFreeTime(input: SuggestFreeTimeInput): Promise<Result<SuggestionOutput, PlannerError>>;
}
