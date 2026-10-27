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

/**
 * Shows the model short stand-ins (m1, m2, ...) instead of real member ids, and turns its answers back. Real ids
 * are long and meaningless to the model, so this saves tokens and keeps them out of prompts, and a name the
 * model never saw cannot leak out of it.
 */
export class AliasingPlanner implements Planner {
  private readonly toAlias: ReadonlyMap<string, string>;
  private readonly fromAlias: ReadonlyMap<string, string>;

  constructor(
    private readonly inner: Planner,
    memberIds: readonly string[],
  ) {
    this.toAlias = new Map(memberIds.map((id, index) => [id, `m${index + 1}`]));
    this.fromAlias = new Map([...this.toAlias].map(([id, alias]) => [alias, id]));
  }

  private alias = (id: string): string => this.toAlias.get(id) ?? id;
  private real = (alias: string): string => this.fromAlias.get(alias) ?? alias;
  private aliasConstraints = (set: ConstraintSet): ConstraintSet => Object.fromEntries(Object.entries(set).map(([id, value]) => [this.alias(id), value]));

  async extractConstraints(input: ExtractConstraintsInput): Promise<Result<ConstraintSet, PlannerError>> {
    const result = await this.inner.extractConstraints({ ...input, memberIds: input.memberIds.map(this.alias), messages: input.messages.map((m) => ({ ...m, memberId: this.alias(m.memberId) })) });
    if (!result.ok) return result;
    // An alias the model made up maps to nobody, so it is dropped.
    return ok(Object.fromEntries(Object.entries(result.value).filter(([alias]) => this.fromAlias.has(alias)).map(([alias, value]) => [this.real(alias), value])));
  }

  extractTripBrief(input: ExtractTripBriefInput): Promise<Result<TripBriefOutput, PlannerError>> {
    return this.inner.extractTripBrief({ ...input, memberIds: input.memberIds.map(this.alias), messages: input.messages.map((m) => ({ ...m, memberId: this.alias(m.memberId) })) });
  }

  async proposePlan(input: ProposePlanInput): Promise<Result<PlannerOutput, PlannerError>> {
    const result = await this.inner.proposePlan({
      ...input,
      memberIds: input.memberIds.map(this.alias),
      constraints: this.aliasConstraints(input.constraints),
      feedback: input.feedback.map((line) => replaceIds(line, this.toAlias)),
    });
    if (!result.ok) return result;
    return ok({
      ...result.value,
      picks: result.value.picks.map((pick) => ({ ...pick, members: pick.members.map((m) => ({ ...m, memberId: this.real(m.memberId) })) })),
      compromises: result.value.compromises?.map((c) => ({ ...c, memberId: this.real(c.memberId) })),
    });
  }

  suggestFreeTime(input: SuggestFreeTimeInput): Promise<Result<SuggestionOutput, PlannerError>> {
    return this.inner.suggestFreeTime({
      ...input,
      memberIds: input.memberIds.map(this.alias),
      constraints: this.aliasConstraints(input.constraints),
      feedback: input.feedback.map((line) => replaceIds(line, this.toAlias)),
    });
  }
}

/** Turns member ids in a message into their display names, for text shown to the group. */
export function nameMembers(text: string, members: readonly { readonly id: string; readonly displayName: string }[]): string {
  return replaceIds(text, new Map(members.map((member) => [member.id, member.displayName])));
}

