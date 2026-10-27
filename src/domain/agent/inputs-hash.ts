import { createHash } from "node:crypto";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { CompleteTrip } from "@/domain/trip/brief";

/** The same data always writes the same text: object keys are sorted, so their order never changes the result. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface PlanInputs {
  readonly trip: CompleteTrip;
  readonly memberIds: readonly string[];
  readonly constraints: ConstraintSet;
  /** Set only when some people do not fly, so plans made before this existed keep their fingerprint. */
  readonly flyingMemberIds?: readonly string[];
}

/**
 * A fingerprint of everything a plan is built from: where and when, who is in it, and what each person asked for.
 * If it is the same now as when the plan was made, nothing has happened that should change the plan.
 */
export function computeInputsHash(inputs: PlanInputs): string {
  const memberIds = [...inputs.memberIds].sort();
  // Only people in the plan matter, and someone who said nothing counts the same as an empty set of constraints.
  const constraints = Object.fromEntries(memberIds.map((id) => [id, inputs.constraints[id] ?? {}]));
  const flying = inputs.flyingMemberIds ? [...inputs.flyingMemberIds].sort() : undefined;
  return createHash("sha256").update(canonical({ trip: inputs.trip, memberIds, constraints, flying })).digest("hex");
}
