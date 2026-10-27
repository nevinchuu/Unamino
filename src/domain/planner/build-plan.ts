import { err, ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { Offer, OfferKind } from "@/domain/offers/schema";
import { computeMemberShares } from "@/domain/split/shares";
import type { FxRateTable, LineItem, MemberInput, MemberShare } from "@/domain/split/types";
import { findConstraintViolations, type ConstraintViolation } from "./check-constraints";
import { toLineItems } from "./line-items";
import type { Planner } from "./planner";
import { validatePlan, type ValidatedPlan } from "./validate";

const DEFAULT_MAX_ATTEMPTS = 3;

export interface BuildPlanInput {
  readonly planner: Pick<Planner, "proposePlan">;
  readonly members: readonly MemberInput[];
  readonly constraints: ConstraintSet;
  readonly offers: readonly Offer[];
  readonly fx: FxRateTable;
  readonly requiredKinds: readonly OfferKind[];
  readonly now: Date;
  readonly maxAttempts?: number;
}

export interface BuiltPlan {
  readonly plan: ValidatedPlan;
  readonly lineItems: readonly LineItem[];
  readonly shares: readonly MemberShare[];
  /** Where the plan still breaks a member's constraints. Empty means everyone is fully served. */
  readonly violations: readonly ConstraintViolation[];
  readonly attempts: number;
}

export type BuildPlanErrorCode = "planner_unavailable" | "no_valid_plan" | "split_failed";

export interface BuildPlanError {
  readonly code: BuildPlanErrorCode;
  readonly message: string;
}

/**
 * Asks the planner for a plan, checks it against the real offers and the members' constraints, and asks again
 * with feedback if it is invalid or breaks constraints. Returns the valid plan that serves the most members;
 * constraints that cannot all be met are reported as violations rather than hidden.
 */
export async function buildPlan(input: BuildPlanInput): Promise<Result<BuiltPlan, BuildPlanError>> {
  const { planner, members, constraints, offers, fx, requiredKinds, now } = input;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const memberIds = members.map((member) => member.id);

  let feedback: readonly string[] = [];
  let lastProblem = "The planner did not produce a plan";
  let best: BuiltPlan | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const proposed = await planner.proposePlan({ memberIds, constraints, offers, requiredKinds, feedback });
    if (!proposed.ok) {
      if (proposed.error.code === "planner_unavailable") return err({ code: "planner_unavailable", message: proposed.error.message });
      lastProblem = proposed.error.message;
      feedback = [proposed.error.message];
      continue;
    }

    const validated = validatePlan(proposed.value, { offers, memberIds, requiredKinds, now });
    if (!validated.ok) {
      lastProblem = validated.error.message;
      feedback = [validated.error.message];
      continue;
    }

    const lineItems = toLineItems(validated.value);
    const shares = computeMemberShares({ lineItems, members, fx });
    if (!shares.ok) return err({ code: "split_failed", message: shares.error.message });

    const violations = findConstraintViolations({ plan: validated.value, constraints, shares: shares.value });
    if (best === null || violations.length < best.violations.length) {
      best = { plan: validated.value, lineItems, shares: shares.value, violations, attempts: attempt };
    }
    if (violations.length === 0) break;
    feedback = violations.map((violation) => violation.message);
  }

  return best ? ok(best) : err({ code: "no_valid_plan", message: lastProblem });
}
