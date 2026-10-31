import type { ChatModel } from "@/domain/agent/loop/model";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import { writeNudge, type NudgeFacts } from "@/domain/nudge/nudge";
import { planBriefFor } from "@/domain/persona/plan-facts";
import type { PaymentsMode } from "@/domain/payments/types";
import { buildPlanView } from "@/domain/plan/view";
import type { PlanViewRaw, PlanViewStore, ViewMember } from "@/domain/plan/view-store";
import { fallbackNudge, REMINDER_COOLDOWN_MS, REMINDER_MARKER, reminderLine, type ReminderStep } from "@/lib/reminder";
import { isUuid } from "./ids";

export type RemindResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface RemindDeps {
  readonly views: Pick<PlanViewStore, "load">;
  readonly messages: Pick<MessageRepository, "recent" | "postSystem" | "postAgent">;
  readonly groups: Pick<GroupRepository, "memberNames">;
  readonly payments: PaymentsMode;
  /** Words each nudge. Without it, or when it fails, the plain wording is used. */
  readonly model?: () => ChatModel;
  readonly clock: () => Date;
}

/** Most people whose nudge is worded by the model in one go. Anyone beyond that gets the plain wording, so one press costs a bounded amount. */
const MAX_WORDED = 6;
/** How much of the chat the model sees when it words a nudge. */
const CHAT_WINDOW = 12;
const MS_PER_MINUTE = 60_000;

const NOT_SIGNED_IN = "Open your invite link to rejoin this group.";
const NOT_FOUND = "We couldn't find that plan.";
const NOT_IN_PLAN = "You're not part of this plan.";
const MOVED_ON = "The plan has moved on, so there is nobody to remind.";
const DO_YOURS_FIRST = "Do your own part first, then remind the others.";
const NOBODY = "Everyone has done their part.";
const TOO_SOON = "A reminder went out a moment ago. Give them a few minutes.";
const TRY_AGAIN = "Something went wrong on our side. Try again in a moment.";

/** Which step the plan is on, and who has done what it asks: agreeing while it is reviewed, holding a card once amounts are approved. */
function stepOf(plan: PlanViewRaw): { readonly step: ReminderStep; readonly done: (member: PlanViewRaw["members"][number]) => boolean } | null {
  if (plan.status === "reviewing" || plan.status === "draft") return { step: "agree", done: (member) => member.planAgreement === "agreed" };
  if (plan.status === "approving") return { step: "approve", done: (member) => member.holdPlaced };
  return null;
}

/**
 * What Trippy needs to word a nudge for one person. Their share is worked out as their own screen would, so the amount
 * the nudge may quote is the amount they will see.
 */
function factsFor(
  deps: RemindDeps,
  plan: PlanViewRaw,
  person: ViewMember,
  sender: Member,
  step: ReminderStep,
  now: Date,
  chat: NudgeFacts["chat"],
): NudgeFacts {
  const shareMinor = buildPlanView(plan, person.id, { payments: deps.payments }).me.shareMinor;
  const brief = planBriefFor(plan, person.id, shareMinor, now);
  const minutes = Math.floor((plan.deadlineAt.getTime() - now.getTime()) / MS_PER_MINUTE);
  return {
    name: person.name,
    sender: sender.displayName,
    step,
    shareText: brief.yourShare,
    minutesLeft: minutes > 0 ? minutes : null,
    hotel: brief.hotel,
    freeToCancel: brief.freeCancellation,
    others: plan.members.filter((other) => other.id !== person.id && other.id !== sender.id).map((other) => other.name),
    chat,
  };
}

/** The nudge for one person: the model's wording when it is usable, the plain wording otherwise. */
async function nudgeFor(model: ChatModel | null, facts: NudgeFacts): Promise<string> {
  if (!model) return fallbackNudge(facts.name, facts.step);
  try {
    return (await writeNudge(model, facts)) ?? fallbackNudge(facts.name, facts.step);
  } catch {
    // A model that cannot be reached must not stop the nudge.
    return fallbackNudge(facts.name, facts.step);
  }
}

/**
 * Nudges the people a plan is waiting for. A chat line says who asked, then Trippy writes a short word to each person,
 * using what they said in the chat and their own amount. The sender must be in the plan and have done their own part,
 * the plan must still be open, and one reminder at a time is allowed, because a button pressed twice should not nag
 * anyone. All of it is checked here and not trusted from the page.
 */
export async function runRemind(deps: RemindDeps, member: Member | null, input: { readonly groupId: string; readonly planId: string }): Promise<RemindResult> {
  if (!member || member.groupId !== input.groupId) return { ok: false, error: NOT_SIGNED_IN };
  if (!isUuid(input.planId)) return { ok: false, error: NOT_FOUND };

  const loaded = await deps.views.load(input.planId);
  if (!loaded.ok) return { ok: false, error: loaded.error.code === "not_found" ? NOT_FOUND : TRY_AGAIN };
  const plan = loaded.value;
  // A plan in someone else's group gets the same answer as a plan that does not exist.
  if (plan.groupId !== member.groupId) return { ok: false, error: NOT_FOUND };

  const me = plan.members.find((person) => person.id === member.id);
  if (!me) return { ok: false, error: NOT_IN_PLAN };
  const stage = stepOf(plan);
  if (!stage) return { ok: false, error: MOVED_ON };
  if (!stage.done(me)) return { ok: false, error: DO_YOURS_FIRST };

  const waiting = plan.members.filter((person) => !stage.done(person));
  const line = reminderLine(member.displayName, waiting.map((person) => person.name));
  if (line === null) return { ok: false, error: NOBODY };

  const now = deps.clock();
  const recent = await deps.messages.recent(member.groupId, 20);
  if (recent.some((message) => message.kind === "system" && message.body.includes(REMINDER_MARKER) && now.getTime() - message.createdAt.getTime() < REMINDER_COOLDOWN_MS)) return { ok: false, error: TOO_SOON };

  // The marker line goes first, so a second press is held back even while the nudges are still being written.
  const posted = await deps.messages.postSystem(member.groupId, line);
  if (!posted.ok) return { ok: false, error: TRY_AGAIN };

  const names = await deps.groups.memberNames(member.groupId);
  const chat = recent.slice(-CHAT_WINDOW).map((message) => ({ from: message.kind === "agent" ? "Trippy" : message.kind === "system" ? "App" : (names.get(message.memberId ?? "") ?? "Someone"), text: message.body }));
  const model = deps.model?.() ?? null;
  const nudges = await Promise.all(
    waiting.map((person, index) => nudgeFor(index < MAX_WORDED ? model : null, factsFor(deps, plan, person, member, stage.step, now, chat))),
  );
  // The plan has already been nudged for as far as the chat line goes; one nudge failing to post does not undo the others.
  for (const nudge of nudges) await deps.messages.postAgent(member.groupId, nudge);
  return { ok: true };
}
