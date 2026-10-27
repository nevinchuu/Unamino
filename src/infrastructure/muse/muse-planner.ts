import { err, ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { PlannerError } from "@/domain/planner/errors";
import type { ExtractConstraintsInput, Planner, ProposePlanInput, SuggestFreeTimeInput } from "@/domain/planner/planner";
import { parseExtractionText, parsePlannerText, type PlannerOutput } from "@/domain/planner/schema";
import { parseSuggestionText, type SuggestionOutput } from "@/domain/schedule/suggestion-schema";
import type { Completion, CompletionRequest, MuseError } from "./muse-http";
import { buildExtractConstraintsPrompt } from "./prompts/extract-constraints";
import { buildProposePlanPrompt } from "./prompts/propose-plan";
import { buildSuggestFreeTimePrompt } from "./prompts/suggest-free-time";

/** The part of the transport the planner needs, so tests can stand in for it. */
export interface CompletionClient {
  complete(request: CompletionRequest): Promise<Result<Completion, MuseError>>;
}

/**
 * Reading the chat (constraints) has no outer retry loop, so it gets one more try of its own when Muse answers badly.
 * The plan and the suggestions already have loops that feed back what was wrong.
 */
const READ_ATTEMPTS = 2;

const unavailable = (message: string): PlannerError => ({ code: "planner_unavailable", message });
const invalid = (message: string): PlannerError => ({ code: "invalid_output", message });

/**
 * A call that failed is reported, not fed back: a bad key or an outage is not something the model can fix.
 * An answer that was empty, refused or not understood can be tried again.
 */
function toPlannerError(error: MuseError): PlannerError {
  switch (error.code) {
    case "unavailable":
    case "truncated":
      return unavailable(error.message);
    case "refused":
    case "invalid_response":
      return invalid(error.message);
  }
}

/** The AI side of planning, backed by Meta's Muse model. Everything it returns is checked by code afterwards. */
export class MusePlanner implements Planner {
  constructor(private readonly client: CompletionClient) {}

  async extractConstraints(input: ExtractConstraintsInput): Promise<Result<ConstraintSet, PlannerError>> {
    const answer = await this.askWithRetry(buildExtractConstraintsPrompt(input), parseExtractionText);
    if (!answer.ok) return answer;
    // A member id the model made up cannot belong to anyone, so it is dropped rather than trusted.
    const known = new Set(input.memberIds);
    return ok(Object.fromEntries(Object.entries(answer.value.constraints).filter(([memberId]) => known.has(memberId))));
  }

  proposePlan(input: ProposePlanInput): Promise<Result<PlannerOutput, PlannerError>> {
    return this.ask(buildProposePlanPrompt(input), parsePlannerText);
  }

  suggestFreeTime(input: SuggestFreeTimeInput): Promise<Result<SuggestionOutput, PlannerError>> {
    return this.ask(buildSuggestFreeTimePrompt(input), parseSuggestionText);
  }

  /** Asks again once when the answer is unusable. A failed call is not retried: the model cannot fix an outage. */
  private async askWithRetry<T>(
    request: CompletionRequest,
    parse: (text: string) => Result<T, { readonly message: string }>,
  ): Promise<Result<T, PlannerError>> {
    let lastProblem: PlannerError = invalid("Muse did not return a usable answer");
    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
      const answer = await this.ask(request, parse);
      if (answer.ok || answer.error.code === "planner_unavailable") return answer;
      lastProblem = answer.error;
    }
    return err(lastProblem);
  }

  /** Sends one prompt and parses the text that comes back. Parse problems keep their plain-words message for feedback. */
  private async ask<T>(
    request: CompletionRequest,
    parse: (text: string) => Result<T, { readonly message: string }>,
  ): Promise<Result<T, PlannerError>> {
    const completion = await this.client.complete(request);
    if (!completion.ok) return err(toPlannerError(completion.error));
    const parsed = parse(completion.value.text);
    return parsed.ok ? ok(parsed.value) : err(invalid(parsed.error.message));
  }
}
