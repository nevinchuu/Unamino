import { err, ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { Planner } from "@/domain/planner/planner";
import { toMinutes } from "./time";
import type { FreeGap } from "./types";
import { verifySuggestion, type Rejection, type TakenSlots, type VerifiedSuggestion } from "./verify-suggestion";
import type { VenueLookup } from "./venue";

const DEFAULT_MAX_ATTEMPTS = 2;

export interface FreeTimeRequest {
  readonly planner: Planner;
  readonly lookup: VenueLookup;
  readonly gaps: readonly FreeGap[];
  readonly memberIds: readonly string[];
  readonly constraints: ConstraintSet;
  readonly city: string;
  readonly now: Date;
  readonly maxAttempts?: number;
}

export interface FreeTimeSuggestions {
  /** Places confirmed to exist and be open at the planned time. Only these are shown. */
  readonly verified: readonly VerifiedSuggestion[];
  /** What was proposed but could not be confirmed, kept so the reasons can be shown or logged. */
  readonly rejected: readonly Rejection[];
  readonly attempts: number;
}

export type SuggestFreeTimeErrorCode = "planner_unavailable";

export interface SuggestFreeTimeError {
  readonly code: SuggestFreeTimeErrorCode;
  readonly message: string;
}

const takenBy = (verified: readonly VerifiedSuggestion[]): TakenSlots => ({
  placeIds: new Set(verified.map((item) => item.venue.placeId)),
  windows: verified.map((item) => ({ date: item.date, start: toMinutes(item.startTime), end: toMinutes(item.endTime) })),
});

/** Rejections the planner can learn from. A lookup outage is not the planner's mistake. */
const feedbackFor = (rejections: readonly Rejection[]): readonly string[] =>
  rejections
    .filter((rejection) => rejection.code !== "lookup_unavailable")
    .map(({ suggestion, message }) => `"${suggestion.venueName}" at ${suggestion.startTime} (${suggestion.gapId}) was rejected: ${message}`);

/**
 * Asks the planner for things to do in the free gaps and keeps only the places that are confirmed open.
 * Rejected ideas go back to the planner as feedback for another try. Suggestions that cannot be confirmed
 * are dropped, never shown.
 */
export async function suggestFreeTime(input: FreeTimeRequest): Promise<Result<FreeTimeSuggestions, SuggestFreeTimeError>> {
  const { planner, lookup, gaps, memberIds, constraints, city, now } = input;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const verified: VerifiedSuggestion[] = [];
  let rejected: Rejection[] = [];
  let feedback: readonly string[] = [];
  let attempts = 0;

  while (attempts < maxAttempts && gaps.length > 0) {
    attempts += 1;
    const proposed = await planner.suggestFreeTime({ city, memberIds, constraints, gaps, feedback });
    if (!proposed.ok) {
      if (proposed.error.code === "planner_unavailable") return err({ code: "planner_unavailable", message: proposed.error.message });
      feedback = [proposed.error.message];
      continue;
    }

    // Checked one at a time so each accepted place is taken into account by the ones after it.
    rejected = [];
    for (const suggestion of proposed.value.suggestions) {
      const result = await verifySuggestion(suggestion, { gaps, memberIds, constraints, city, lookup, taken: takenBy(verified), now });
      if (result.ok) verified.push(result.value);
      else rejected.push(result.error);
    }

    feedback = feedbackFor(rejected);
    if (feedback.length === 0) break;
  }
  return ok({ verified, rejected, attempts });
}
