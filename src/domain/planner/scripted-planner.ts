import { err, ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { SuggestionOutput } from "@/domain/schedule/suggestion-schema";
import type { TripBriefOutput } from "@/domain/trip/brief-schema";
import type { PlannerError } from "./errors";
import type { ExtractConstraintsInput, ExtractTripBriefInput, Planner, ProposePlanInput, SuggestFreeTimeInput } from "./planner";
import type { PlannerOutput } from "./schema";

export interface ScriptedPlannerScript {
  readonly constraints?: Result<ConstraintSet, PlannerError>;
  /** One answer per call to `extractTripBrief`, repeating the last. An empty brief with no questions if omitted. */
  readonly tripBriefs?: readonly Result<TripBriefOutput, PlannerError>[];
  /** One answer per call to `proposePlan`, in order. The last one repeats if the planner is asked more often. */
  readonly plans: readonly Result<PlannerOutput, PlannerError>[];
  /** One answer per call to `suggestFreeTime`, in order, repeating the last. No suggestions if omitted. */
  readonly suggestions?: readonly Result<SuggestionOutput, PlannerError>[];
}

/** The next prepared answer, repeating the last one once they run out. */
const nextAnswer = <T>(answers: readonly T[], callCount: number): T | undefined =>
  answers[Math.min(callCount, answers.length) - 1];

/**
 * A planner that returns prepared answers and records what it was asked.
 * It stands in for the AI in tests and until the Muse key is wired in.
 */
export class ScriptedPlanner implements Planner {
  readonly proposeCalls: ProposePlanInput[] = [];
  readonly extractCalls: ExtractConstraintsInput[] = [];
  readonly briefCalls: ExtractTripBriefInput[] = [];
  readonly suggestCalls: SuggestFreeTimeInput[] = [];

  constructor(private readonly script: ScriptedPlannerScript) {}

  async extractConstraints(input: ExtractConstraintsInput): Promise<Result<ConstraintSet, PlannerError>> {
    this.extractCalls.push(input);
    return this.script.constraints ?? ok({});
  }

  async extractTripBrief(input: ExtractTripBriefInput): Promise<Result<TripBriefOutput, PlannerError>> {
    this.briefCalls.push(input);
    return nextAnswer(this.script.tripBriefs ?? [], this.briefCalls.length) ?? ok({ fields: {}, questions: [] });
  }

  async proposePlan(input: ProposePlanInput): Promise<Result<PlannerOutput, PlannerError>> {
    this.proposeCalls.push(input);
    return nextAnswer(this.script.plans, this.proposeCalls.length) ?? err({ code: "planner_unavailable", message: "The scripted planner has no answers" });
  }

  async suggestFreeTime(input: SuggestFreeTimeInput): Promise<Result<SuggestionOutput, PlannerError>> {
    this.suggestCalls.push(input);
    return nextAnswer(this.script.suggestions ?? [], this.suggestCalls.length) ?? ok({ suggestions: [] });
  }
}
