import { ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { PlannerError } from "@/domain/planner/errors";
import type { ExtractConstraintsInput, ExtractTripBriefInput, Planner, ProposePlanInput, SuggestFreeTimeInput } from "@/domain/planner/planner";
import type { PlannerOutput } from "@/domain/planner/schema";
import type { SuggestionOutput } from "@/domain/schedule/suggestion-schema";
import type { TripBriefOutput } from "@/domain/trip/brief-schema";

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces each id in `text` with its stand-in, whole ids only. */
function replaceIds(text: string, replacements: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [from, to] of replacements) result = result.replace(new RegExp(`(?<![\\w-])${escapeRegex(from)}(?![\\w-])`, "g"), to);
  return result;
}

/** A stand-in on its own, such as m3 or m3's, and not inside a longer word or id. */
const STAND_IN = /(?<![\w-])m\d+(?![\w-])/g;

export interface Person {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Shows the model short stand-ins (m1, m2, ...) instead of real member ids, and turns its answers back. Real ids
 * are long and meaningless to the model, so this saves tokens and keeps them out of prompts, and a name the
 * model never saw cannot leak out of it. The model also uses the stand-ins in its own sentences ("a room for
 * m3"), so every piece of its text that reaches the group is turned into the person's name.
 */
export class AliasingPlanner implements Planner {
  private readonly toAlias: ReadonlyMap<string, string>;
  private readonly fromAlias: ReadonlyMap<string, string>;
  private readonly nameOfAlias: ReadonlyMap<string, string>;

  constructor(
    private readonly inner: Planner,
    people: readonly Person[],
  ) {
    this.toAlias = new Map(people.map((person, index) => [person.id, `m${index + 1}`]));
    this.fromAlias = new Map([...this.toAlias].map(([id, alias]) => [alias, id]));
    this.nameOfAlias = new Map(people.map((person, index) => [`m${index + 1}`, person.displayName]));
  }

  /** Names for the stand-ins in a sentence. One that is not a real stand-in (m9 in a group of four) is left as it was written. */
  private named = (text: string): string => text.replace(STAND_IN, (standIn) => this.nameOfAlias.get(standIn) ?? standIn);

  private alias = (id: string): string => this.toAlias.get(id) ?? id;
  private real = (alias: string): string => this.fromAlias.get(alias) ?? alias;
  private aliasConstraints = (set: ConstraintSet): ConstraintSet => Object.fromEntries(Object.entries(set).map(([id, value]) => [this.alias(id), value]));

  async extractConstraints(input: ExtractConstraintsInput): Promise<Result<ConstraintSet, PlannerError>> {
    const result = await this.inner.extractConstraints({ ...input, memberIds: input.memberIds.map(this.alias), messages: input.messages.map((m) => ({ ...m, memberId: this.alias(m.memberId) })) });
    if (!result.ok) return result;
    // An alias the model made up maps to nobody, so it is dropped.
    return ok(Object.fromEntries(Object.entries(result.value).filter(([alias]) => this.fromAlias.has(alias)).map(([alias, value]) => [this.real(alias), value])));
  }

  async extractTripBrief(input: ExtractTripBriefInput): Promise<Result<TripBriefOutput, PlannerError>> {
    const result = await this.inner.extractTripBrief({ ...input, memberIds: input.memberIds.map(this.alias), messages: input.messages.map((m) => ({ ...m, memberId: this.alias(m.memberId) })) });
    // The questions are posted to the group as they are.
    return result.ok ? ok({ ...result.value, questions: result.value.questions.map(this.named) }) : result;
  }

  async proposePlan(input: ProposePlanInput): Promise<Result<PlannerOutput, PlannerError>> {
    const result = await this.inner.proposePlan({
      ...input,
      memberIds: input.memberIds.map(this.alias),
      constraints: this.aliasConstraints(input.constraints),
      feedback: input.feedback.map((line) => replaceIds(line, this.toAlias)),
    });
    if (!result.ok) return result;
    const plan = result.value;
    return ok({
      ...plan,
      title: this.named(plan.title),
      ...(plan.summary !== undefined && { summary: this.named(plan.summary) }),
      picks: plan.picks.map((pick) => ({ ...pick, reason: this.named(pick.reason), members: pick.members.map((m) => ({ memberId: this.real(m.memberId), note: this.named(m.note) })) })),
      compromises: plan.compromises?.map((c) => ({ memberId: this.real(c.memberId), note: this.named(c.note) })),
    });
  }

  async suggestFreeTime(input: SuggestFreeTimeInput): Promise<Result<SuggestionOutput, PlannerError>> {
    const result = await this.inner.suggestFreeTime({
      ...input,
      memberIds: input.memberIds.map(this.alias),
      constraints: this.aliasConstraints(input.constraints),
      feedback: input.feedback.map((line) => replaceIds(line, this.toAlias)),
    });
    return result.ok ? ok({ suggestions: result.value.suggestions.map((suggestion) => ({ ...suggestion, why: this.named(suggestion.why) })) }) : result;
  }
}

/** Turns member ids in a message into their display names, for text shown to the group. */
export function nameMembers(text: string, members: readonly { readonly id: string; readonly displayName: string }[]): string {
  return replaceIds(text, new Map(members.map((member) => [member.id, member.displayName])));
}

