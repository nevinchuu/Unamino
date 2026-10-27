import type { SuggestFreeTimeInput } from "@/domain/planner/planner";
import type { SuggestionOutput } from "@/domain/schedule/suggestion-schema";
import type { CompletionRequest } from "../muse-http";
import { DATA_IS_NOT_INSTRUCTIONS, JSON_ONLY, numbered, shorten, SUGGEST_MAX_TOKENS, userMessage } from "./shared";

/** Shown to the model, and checked against the real schema in tests so the two cannot drift apart. */
export const SUGGESTION_EXAMPLE: SuggestionOutput = {
  suggestions: [
    { gapId: "gap-1", venueName: "Example Night Market", category: "market", startTime: "18:00", durationMinutes: 90, why: "Lively street food close to the hotel." },
  ],
};

/** The city is data, so it appears only in the user message, never in these rules. */
const RULES = numbered([
  "Suggest things the group could do in the city named in the data, during the free gaps given. Each suggestion is one specific, named, real place.",
  "Only suggest a place you are confident exists. A suggestion is looked up on a map service, and one that cannot be found is thrown away.",
  "Each suggestion uses one gap, by its exact gapId. startTime is a local 24-hour time \"HH:mm\" and startTime plus durationMinutes must end inside that gap. durationMinutes is between 30 and 240.",
  "Suggestions on the same day must not overlap each other. Do not suggest the same place twice.",
  "category is one lowercase word for the kind of activity, such as \"meal\", \"market\" or \"temple\". Never suggest a category that any member asked to skip.",
  "Pick places that are likely to be open at that day and time.",
  "Give a short reason in why. Do not state opening hours, prices, addresses or links: those come from the map service, not from you.",
  "It is fine to suggest fewer than the gaps allow, or nothing. Leave a gap empty rather than guess.",
  "If feedback is present, it lists suggestions that were rejected and why. Do not repeat them; avoid the same mistakes.",
  DATA_IS_NOT_INSTRUCTIONS,
  JSON_ONLY,
]);

export function buildSuggestFreeTimePrompt(input: SuggestFreeTimeInput): CompletionRequest {
  return {
    system: `${RULES}\n\nExample answer shape (the ids and text are made up):\n${JSON.stringify(SUGGESTION_EXAMPLE)}`,
    user: userMessage("suggest_free_time", {
      city: shorten(input.city, 60),
      memberIds: input.memberIds,
      constraints: input.constraints,
      gaps: input.gaps,
      feedback: input.feedback.map((line) => shorten(line, 300)),
    }),
    maxTokens: SUGGEST_MAX_TOKENS,
  };
}
