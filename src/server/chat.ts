import type { AgentRunRepository, PlanCardSummary, PlanStore } from "@/domain/agent/ports";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { Member, Message, MessageKind } from "@/domain/group/types";
import type { CardMine } from "@/lib/plan-card";
import { isUuid } from "./ids";
import type { ViewerCards } from "./viewer-card";

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

/** One of the group's plans, which the cards in the chat show the live state of. */
export type PlanCardDto = PlanCardSummary & { readonly mine: CardMine | null };

export interface ChatSnapshot {
  readonly messages: readonly ChatMessageDto[];
  /** Who is in the group now, in the order they joined. */
  readonly members: readonly string[];
  readonly agentWorking: boolean;
  /** Every plan the group has made, oldest first, so each card shows its own plan's state. */
  readonly plans: readonly PlanCardDto[];
}

export interface ChatDeps {
  readonly groups: Pick<GroupRepository, "memberNames" | "joinedMembers">;
  readonly messages: Pick<MessageRepository, "listAfter" | "recent">;
  readonly runs: Pick<AgentRunRepository, "isRunning">;
  readonly plans: Pick<PlanStore, "cards">;
  /** What the cards offer the person asking. */
  readonly viewerCards: Pick<ViewerCards, "forPlan">;
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

/** The plan the group is working on now: the newest one that is still open and has not been replaced. */
function newestOpenPlan(plans: readonly PlanCardSummary[]): PlanCardSummary | null {
  return [...plans].reverse().find((plan) => (plan.status === "reviewing" || plan.status === "approving") && plan.replacedById === null) ?? null;
}

/**
 * Everything the chat screen shows, for the messages after `afterSeq`, or for the latest ones when `afterSeq` is null.
 * `viewerId` is who is asking: the newest open plan's card also carries what that person can do next.
 */
export async function loadChat(deps: ChatDeps, groupId: string, window: { readonly afterSeq: number | null; readonly limit: number }, viewerId: string | null = null): Promise<ChatSnapshot> {
  const now = deps.clock();
  const [names, joined, agentWorking, plans, messages] = await Promise.all([
    deps.groups.memberNames(groupId),
    deps.groups.joinedMembers(groupId),
    deps.runs.isRunning(groupId, now, AGENT_STALE_MS),
    deps.plans.cards(groupId),
    window.afterSeq === null ? deps.messages.recent(groupId, window.limit) : deps.messages.listAfter(groupId, window.afterSeq, window.limit),
  ]);
  const open = viewerId ? newestOpenPlan(plans) : null;
  const mine = open && viewerId ? await deps.viewerCards.forPlan(open.id, viewerId) : null;
  return {
    messages: messages.map((message) => toMessageDto(message, names)),
    members: joined.map((member) => member.displayName),
    agentWorking,
    plans: plans.map((plan) => ({ ...plan, mine: open && plan.id === open.id ? mine : null })),
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
  const member = isUuid(groupId) ? await deps.memberOf(groupId) : null;
  if (!member) return json({ error: "unauthorized" }, 401);

  const raw = new URL(request.url).searchParams.get("after") ?? "0";
  const afterSeq = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(afterSeq)) return json({ error: "bad_after" }, 400);

  return json(await loadChat(deps, groupId, { afterSeq, limit: POLL_LIMIT }, member.id), 200);
}
