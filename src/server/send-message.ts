import { err, ok, type Result } from "@/lib/result";
import { startAgentRun, type AgentDeps } from "@/domain/agent/run-agent";
import type { AgentRun } from "@/domain/agent/ports";
import type { MessageRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import { toMessageDto, type ChatMessageDto } from "./chat";
import { groupErrorMessage } from "./forms";

export interface SendDeps {
  readonly messages: Pick<MessageRepository, "post">;
  /** Only what starting a run needs; the caller holds the full set to run it. */
  readonly agent: Pick<AgentDeps, "runs" | "messages" | "clock" | "staleRunMs">;
}

/** "unauthorized": not a member of this group. "refused": the message was not acceptable. "unavailable": try again. */
export type SendError = { readonly code: "unauthorized" | "refused" | "unavailable"; readonly message: string };

export interface Sent {
  readonly message: ChatMessageDto;
  /** Set when the message called the agent and a run was started. The caller must run it, after the response is sent. */
  readonly run: AgentRun | null;
}

const NOT_A_MEMBER: SendError = { code: "unauthorized", message: "Open your invite link to rejoin this group." };

/**
 * Posts a person's message. If it calls the agent (it mentions it, or replies to it) a run is started here but not
 * run here: running takes about a minute, so the caller does it once the person has their answer.
 */
export async function sendChatMessage(
  deps: SendDeps,
  member: Member | null,
  input: { readonly groupId: string; readonly body: string; readonly replyToMessageId: string | null },
): Promise<Result<Sent, SendError>> {
  // `member` was looked up for this group; the check here is for a caller that passes someone else's.
  if (!member || member.groupId !== input.groupId) return err(NOT_A_MEMBER);

  const posted = await deps.messages.post({ groupId: input.groupId, memberId: member.id, body: input.body, ...(input.replyToMessageId && { replyToMessageId: input.replyToMessageId }) });
  if (!posted.ok) {
    const code = posted.error.code === "unavailable" ? "unavailable" : "refused";
    return err({ code, message: posted.error.code === "invalid_input" ? "Write something first, and keep it under 4,000 characters." : groupErrorMessage(posted.error) });
  }

  const message = toMessageDto(posted.value, new Map([[member.id, member.displayName]]));
  if (!posted.value.mentionsAgent) return ok({ message, run: null });

  const started = await startAgentRun(deps.agent, { id: posted.value.id, groupId: input.groupId, memberId: member.id });
  // A failure to start leaves the message posted: the person's words must not vanish because the agent could not take them.
  return ok({ message, run: started.ok && started.value.status === "started" ? started.value.run : null });
}
