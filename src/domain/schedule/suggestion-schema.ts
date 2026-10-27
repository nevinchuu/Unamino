import { z } from "zod";
import type { Result } from "@/lib/result";
import type { PlanValidationError } from "@/domain/planner/errors";
import { parseJson, parseWith } from "@/domain/planner/schema";

const MAX_SUGGESTIONS = 12;
const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 240;

/**
 * What the planner returns when it suggests things to do in free time: a named place, when to go and why.
 * There is no price, address, hours or link field. Those come from the venue lookup, never from the model.
 */
export const suggestionOutputSchema = z.strictObject({
  suggestions: z
    .array(
      z.strictObject({
        gapId: z.string().min(1),
        venueName: z.string().trim().min(2).max(80),
        /** A lowercase label such as "meal" or "market", compared with what members said they would skip. */
        category: z.string().trim().toLowerCase().min(2).max(30),
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time as HH:mm"),
        durationMinutes: z.number().int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES),
        why: z.string().trim().min(1).max(200),
      }),
    )
    .max(MAX_SUGGESTIONS),
});

export type SuggestionOutput = z.infer<typeof suggestionOutputSchema>;
export type Suggestion = SuggestionOutput["suggestions"][number];

export const parseSuggestionOutput = (value: unknown): Result<SuggestionOutput, PlanValidationError> =>
  parseWith(suggestionOutputSchema, value, "Suggestion output");

/** Parses the model's raw text, tolerating the code fences models often add around JSON. */
export function parseSuggestionText(text: string): Result<SuggestionOutput, PlanValidationError> {
  const json = parseJson(text, "Suggestion output");
  return json.ok ? parseSuggestionOutput(json.value) : json;
}
