import { err, ok, type Result } from "@/lib/result";
import type { MessageRepository } from "@/domain/group/repository";
import type { EffectError, EffectRunner } from "./effects";
import type { RepositoryError } from "./repository";
import type { PlanEffect } from "./types";

export interface ChatEffectDeps {
  readonly groupIdOf: (planId: string) => Promise<Result<string | null, RepositoryError>>;
  readonly memberNames: (groupId: string) => Promise<ReadonlyMap<string, string>>;
  readonly messages: Pick<MessageRepository, "postSystem">;
}

/** The line to put in the chat for an effect, or null when the effect is not something the group needs to be told. */
export function chatLineFor(effect: PlanEffect, names: ReadonlyMap<string, string>): string | null {
  switch (effect.type) {
    case "request_review":
      return "The plan changed, so everyone needs to look at it again.";
    case "request_approval":
      return "Everyone agreed to the plan. Now each person approves their own amount.";
    case "request_reapproval":
      return `${names.get(effect.memberId) ?? "Someone"}'s price went up past the amount they approved, so they need to approve again.`;
    case "book":
      return "Everyone has approved. The next step is booking.";
    case "place_hold":
    case "release_holds":
    case "capture_holds":
      return null;
  }
}

/**
 * Tells the group in the chat when the plan needs them: people have to come back to look, to approve, or to approve
 * again. Without it nobody would know without keeping the plan open.
 */
export class ChatEffectRunner implements EffectRunner {
  constructor(private readonly deps: ChatEffectDeps) {}

  async run(planId: string, _version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    const lines = await this.linesFor(effects, planId);
    if (lines.length === 0) return ok(undefined);

    const group = await this.deps.groupIdOf(planId);
    if (!group.ok || group.value === null) return err({ message: "The chat for this plan could not be found" });
    for (const line of lines) {
      const posted = await this.deps.messages.postSystem(group.value, line);
      if (!posted.ok) return err({ message: "A message could not be posted to the chat" });
    }
    return ok(undefined);
  }

  private async linesFor(effects: readonly PlanEffect[], planId: string): Promise<string[]> {
    // Names are only looked up when an effect needs one.
    const needsNames = effects.some((effect) => effect.type === "request_reapproval");
    let names: ReadonlyMap<string, string> = new Map();
    if (needsNames) {
      const group = await this.deps.groupIdOf(planId);
      if (group.ok && group.value !== null) names = await this.deps.memberNames(group.value);
    }
    return effects.flatMap((effect) => chatLineFor(effect, names) ?? []);
  }
}
