import { err, ok, type Result } from "@/lib/result";
import type { AgentRun } from "@/domain/agent/ports";
import type { Member } from "@/domain/group/types";
import type { PaymentsMode } from "@/domain/payments/types";
import { buildPlanView } from "@/domain/plan/view";
import type { PlanViewStore } from "@/domain/plan/view-store";
import { changeRequestText, cleanNote, isChangeReason } from "@/lib/change-request";
import { formatMinor } from "@/lib/format-money";
import { isUuid } from "./ids";
import { sendChatMessage, type SendDeps } from "./send-message";

export type RequestChangesResult =
  /** `asked` is whether Trippy was started. False when it was busy, in which case the message is still in the chat. */
  | { readonly ok: true; readonly asked: boolean }
  | { readonly ok: false; readonly error: string };

export interface RequestChangesDeps {
  readonly views: Pick<PlanViewStore, "load">;
  readonly send: SendDeps;
  readonly payments: PaymentsMode;
}

const NOT_SIGNED_IN = "Open your invite link to rejoin this group.";
const NOT_FOUND = "We couldn't find that plan.";
const MOVED_ON = "The plan has moved on, so it can't be changed from here. The screen will show where it stands.";

/**
 * Asks Trippy to change the plan, in the person's own name. The person must be in the plan, in the plan's own group,
 * and the plan must still be open to changes: all of that is checked here and not trusted from the page. The request
 * goes in as an ordinary chat message, so the group sees who asked for what and the usual limits on the agent apply.
 */
export async function runRequestChanges(
  deps: RequestChangesDeps,
  member: Member | null,
  input: { readonly planId: string; readonly reason: unknown; readonly note: unknown },
): Promise<Result<{ readonly asked: boolean; readonly run: AgentRun | null }, string>> {
  if (!member) return err(NOT_SIGNED_IN);
  if (!isUuid(input.planId)) return err(NOT_FOUND);
  if (!isChangeReason(input.reason)) return err("Choose what needs to change.");

  const raw = await deps.views.load(input.planId);
  if (!raw.ok) return err(raw.error.code === "not_found" ? NOT_FOUND : "Something went wrong on our side. Try again in a moment.");
  // A plan in someone else's group gets the same answer as a plan that does not exist.
  if (raw.value.groupId !== member.groupId) return err(NOT_FOUND);

  const view = buildPlanView(raw.value, member.id, { payments: deps.payments });
  if (!view.me.actions.requestChanges) return err(MOVED_ON);

  const shareText = view.me.shareMinor === null ? null : formatMinor(view.me.shareMinor, view.currency);
  const body = changeRequestText(input.reason, cleanNote(input.note), shareText);
  const sent = await sendChatMessage(deps.send, member, { groupId: member.groupId, body, replyToMessageId: null });
  if (!sent.ok) return err(sent.error.message);
  return ok({ asked: sent.value.run !== null, run: sent.value.run });
}
