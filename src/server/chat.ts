import type { AgentRunRepository, PlanStore } from "@/domain/agent/ports";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { Member, Message, MessageKind } from "@/domain/group/types";
import type { PlanStatus } from "@/domain/plan/statuses";
import { isUuid } from "./ids";

/** What the agent is called in the chat. */
export const AGENT_NAME = "Trippy";
const FORMER_MEMBER = "Former member";

/** How many messages one poll may bring. A poll that hits it is simply followed by another straight away. */
export const POLL_LIMIT = 100;
/** The chat opens on this many of the latest messages. */
export const INITIAL_MESSAGES = 50;
/** A run still going after this long is treated as dead, the same rule that frees the group for the next call. */
export const AGENT_STALE_MS = 5 * 60_000;

/** A message as the browser sees it. Names are filled in here, so the browser never needs a member list to draw a bubble. */
export interface ChatMessageDto {
  readonly id: string;
  readonly seq: number;
  readonly kind: MessageKind;
  readonly senderId: string | null;
  readonly senderName: string | null;
  readonly body: string;
  readonly replyToId: string | null;
  readonly planId: string | null;
  /** ISO time. */
  readonly at: string;
}

/** The newest plan, which the cards in the chat show the live state of. */
export interface PlanCardDto {
  readonly id: string;
  readonly title: string;
  readonly status: PlanStatus;
  readonly headcount: number;
  readonly agreedCount: number;
}

export interface ChatSnapshot {
  readonly messages: readonly ChatMessageDto[];
  /** Who is in the group now, in the order they joined. */
  readonly members: readonly string[];
  readonly agentWorking: boolean;
  readonly plan: PlanCardDto | null;
}

export interface ChatDeps {
  readonly groups: Pick<GroupRepository, "memberNames" | "joinedMembers">;
  readonly messages: Pick<MessageRepository, "listAfter" | "recent">;
  readonly runs: Pick<AgentRunRepository, "isRunning">;
  readonly plans: Pick<PlanStore, "latest">;
  readonly clock: () => Date;
}

export function toMessageDto(message: Message, names: ReadonlyMap<string, string>): ChatMessageDto {
  const senderName = message.kind === "agent" ? AGENT_NAME : message.kind === "system" ? null : (names.get(message.memberId ?? "") ?? FORMER_MEMBER);
  return {
    id: message.id,
    seq: message.seq,
    kind: message.kind,
    senderId: message.memberId,
    senderName,
    body: message.body,
    replyToId: message.replyToMessageId,
    planId: message.planId,
    at: message.createdAt.toISOString(),
  };
}

/** Everything the chat screen shows, for the messages after `afterSeq`, or for the latest ones when `afterSeq` is null. */
export async function loadChat(deps: ChatDeps, groupId: string, window: { readonly afterSeq: number | null; readonly limit: number }): Promise<ChatSnapshot> {
  const now = deps.clock();
  const [names, joined, agentWorking, latest, messages] = await Promise.all([
    deps.groups.memberNames(groupId),
    deps.groups.joinedMembers(groupId),
    deps.runs.isRunning(groupId, now, AGENT_STALE_MS),
    deps.plans.latest(groupId),
    window.afterSeq === null ? deps.messages.recent(groupId, window.limit) : deps.messages.listAfter(groupId, window.afterSeq, window.limit),
  ]);
  return {
    messages: messages.map((message) => toMessageDto(message, names)),
    members: joined.map((member) => member.displayName),
    agentWorking,
    plan: latest && { id: latest.id, title: latest.title, status: latest.status, headcount: latest.headcount, agreedCount: latest.agreedCount },
  };
}

export interface PollDeps extends ChatDeps {
  /** Who is asking, in this group. Null for anyone who is not a member of it. */
  readonly memberOf: (groupId: string) => Promise<Member | null>;
}

const json = (body: unknown, status: number): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The browser's regular question: what is new since the last message I have? */
export async function handlePoll(request: Request, groupId: string, deps: PollDeps): Promise<Response> {
  // A malformed id and a group the caller is not in get the same answer, so the route does not reveal which groups exist.
  if (!isUuid(groupId) || !(await deps.memberOf(groupId))) return json({ error: "unauthorized" }, 401);

  const raw = new URL(request.url).searchParams.get("after") ?? "0";
  const afterSeq = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(afterSeq)) return json({ error: "bad_after" }, 400);

  return json(await loadChat(deps, groupId, { afterSeq, limit: POLL_LIMIT }), 200);
}
