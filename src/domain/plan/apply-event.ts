import { err, ok, type Result } from "@/lib/result";
import type { PlanRepository, RepositoryError } from "./repository";
import { transition } from "./transition";
import type { PlanEffect, PlanEvent, PlanSnapshot, TransitionError } from "./types";

const DEFAULT_MAX_ATTEMPTS = 6;

export type ApplyEventError =
  | { readonly kind: "transition"; readonly error: TransitionError }
  | { readonly kind: "repository"; readonly error: RepositoryError };

export interface AppliedEvent {
  readonly plan: PlanSnapshot;
  readonly version: number;
  /** What the caller must now do in the outside world. Nothing has been done yet. */
  readonly effects: readonly PlanEffect[];
}

/**
 * Applies one event to a stored plan. If someone else saved in between, the plan is read again and the event
 * is applied to what is there now, because the event may no longer be valid (the plan may have expired, or
 * the member may already have approved). A refused transition is returned, never retried.
 */
export async function applyPlanEvent(
  repository: PlanRepository,
  planId: string,
  event: PlanEvent,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<Result<AppliedEvent, ApplyEventError>> {
  let lastConflict: RepositoryError = { code: "version_conflict", message: "The plan kept changing" };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loaded = await repository.load(planId);
    if (!loaded.ok) return err({ kind: "repository", error: loaded.error });

    const next = transition(loaded.value.plan, event);
    if (!next.ok) return err({ kind: "transition", error: next.error });

    const saved = await repository.save(loaded.value, next.plan);
    if (saved.ok) return ok({ plan: saved.value.plan, version: saved.value.version, effects: next.effects });
    if (saved.error.code !== "version_conflict") return err({ kind: "repository", error: saved.error });
    lastConflict = saved.error;
  }
  return err({ kind: "repository", error: lastConflict });
}
