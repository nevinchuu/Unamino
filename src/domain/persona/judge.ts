import { formatMinor } from "@/lib/format-money";
import type { PersonaRules } from "./profiles";

/** What a persona needs to know about the plan to say whether it suits them. */
export interface PlanFacts {
  /** Their own share at today's prices, in minor units. Null when it cannot be priced. */
  readonly shareMinor: number | null;
  readonly currency: string;
  /** For each hotel room they are in: how many people it holds, and whether it can be cancelled for free. */
  readonly rooms: readonly { readonly occupants: number; readonly freeCancellation: boolean }[];
  /** The plan puts them on a flight. Personas have no passport to give, so this is never acceptable. */
  readonly onFlight: boolean;
}

/** What kind of rule a plan broke, so the wording can be chosen without reading the sentence. */
export type ProblemCode = "flight" | "budget" | "room" | "cancellation";

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[]; readonly codes: readonly ProblemCode[] };

/**
 * Does the plan break any of this persona's own rules? The problems are worded as the persona would meet them, for the model
 * to turn into its own words. The decision is made here, so a persona never agrees to something that breaks its rules.
 */
export function checkRules(rules: PersonaRules, facts: PlanFacts): Verdict {
  const problems: string[] = [];
  const codes: ProblemCode[] = [];
  const note = (code: ProblemCode, sentence: string) => {
    codes.push(code);
    problems.push(sentence);
  };
  if (facts.onFlight) note("flight", "the plan puts you on a flight, and you cannot give passport details");
  if (rules.maxShareMinor !== undefined && facts.shareMinor !== null && facts.shareMinor > rules.maxShareMinor) {
    note("budget", `your share is ${formatMinor(facts.shareMinor, facts.currency)}, above the ${formatMinor(rules.maxShareMinor, facts.currency)} you can afford`);
  }
  if (rules.ownRoom && facts.rooms.some((room) => room.occupants > 1)) note("room", "you would be sharing a hotel room, and you want a room to yourself");
  if (rules.freeCancellation && facts.rooms.some((room) => !room.freeCancellation)) note("cancellation", "the hotel is not free to cancel, and you need one that is");
  return problems.length === 0 ? { ok: true } : { ok: false, problems, codes };
}

/** The most common reason a persona asks for changes, in the words the change request uses. */
export function changeReasonFor(codes: readonly ProblemCode[]): "too_expensive" | "different_pick" {
  return codes.includes("budget") ? "too_expensive" : "different_pick";
}
