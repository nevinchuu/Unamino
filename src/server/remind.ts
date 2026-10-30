import type { MessageRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import type { PlanViewRaw, PlanViewStore } from "@/domain/plan/view-store";
import { REMINDER_COOLDOWN_MS, REMINDER_MARKER, reminderLine, type ReminderStep } from "@/lib/reminder";
import { isUuid } from "./ids";

export type RemindResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface RemindDeps {
  readonly views: Pick<PlanViewStore, "load">;
  readonly messages: Pick<MessageRepository, "recent" | "postSystem">;
  readonly clock: () => Date;
}

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
 * Posts a chat line nudging the people a plan is waiting for, in the sender's name. The sender must be in the plan and
 * have done their own part, the plan must still be open, and one reminder at a time is allowed, because a button pressed
 * twice should not nag anyone. All of it is checked here and not trusted from the page.
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

  const waiting = plan.members.filter((person) => !stage.done(person)).map((person) => person.name);
  const line = reminderLine(member.displayName, stage.step, waiting);
  if (line === null) return { ok: false, error: NOBODY };

  const now = deps.clock().getTime();
  const recent = await deps.messages.recent(member.groupId, 20);
  if (recent.some((message) => message.kind === "system" && message.body.includes(REMINDER_MARKER) && now - message.createdAt.getTime() < REMINDER_COOLDOWN_MS)) return { ok: false, error: TOO_SOON };

  const posted = await deps.messages.postSystem(member.groupId, line);
  return posted.ok ? { ok: true } : { ok: false, error: TRY_AGAIN };
}
