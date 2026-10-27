import { findAlternatives, type AlternativesInput } from "./alternatives";
import { buildMemberQuotes, buildOfferQuotes } from "./member-quotes";
import type { PlanQuote } from "./types";

export type BuildQuoteInput = AlternativesInput;

/** Gathers everything a person needs to judge a plan: what is bought, what they pay, and what else was possible. */
export function buildQuote(input: BuildQuoteInput): PlanQuote {
  const { built, constraints } = input;
  return {
    currency: built.plan.currency,
    totalMinor: built.plan.totalMinor,
    offers: buildOfferQuotes(built.plan.picks, built.shares),
    members: buildMemberQuotes(built.shares, constraints),
    alternatives: findAlternatives(input),
    violations: built.violations,
  };
}
