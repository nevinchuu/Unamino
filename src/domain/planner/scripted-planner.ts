import { err, ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { PlannerError } from "./errors";
import type { ExtractConstraintsInput, Planner, ProposePlanInput } from "./planner";
import type { PlannerOutput } from "./schema";

export interface ScriptedPlannerScript {
  readonly constraints?: Result<ConstraintSet, PlannerError>;
  /** One answer per call to `proposePlan`, in order. The last one repeats if the planner is asked more often. */
  readonly plans: readonly Result<PlannerOutput, PlannerError>[];
}

/**
 * A planner that returns prepared answers and records what it was asked.
 * It stands in for the AI in tests and until the Muse key is wired in.
 */
export class ScriptedPlanner implements Planner {
  readonly proposeCalls: ProposePlanInput[] = [];
  readonly extractCalls: ExtractConstraintsInput[] = [];

  constructor(private readonly script: ScriptedPlannerScript) {}

  async extractConstraints(input: ExtractConstraintsInput): Promise<Result<ConstraintSet, PlannerError>> {
    this.extractCalls.push(input);
    return this.script.constraints ?? ok({});
  }

  async proposePlan(input: ProposePlanInput): Promise<Result<PlannerOutput, PlannerError>> {
    this.proposeCalls.push(input);
    const answer = this.script.plans[Math.min(this.proposeCalls.length, this.script.plans.length) - 1];
    return answer ?? err({ code: "planner_unavailable", message: "The scripted planner has no answers" });
  }
}
