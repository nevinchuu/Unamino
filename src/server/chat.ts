import type { AgentRunRepository, PlanCardSummary, PlanStore } from "@/domain/agent/ports";
import type { ReadMarkers } from "@/domain/group/read-markers";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { Member, Message, MessageKind } from "@/domain/group/types";
import { POLL_LIMIT } from "@/lib/chat-limits";
import type { CardMine } from "@/lib/plan-card";
import { isUuid } from "./ids";
import type { ViewerCards } from "./viewer-card";

/** What the agent is called in the chat. */
export const AGENT_NAME = "Trippy";
const FORMER_MEMBER = "Former member";

export { POLL_LIMIT };
/** The chat opens on this many of the latest messages. */
export const INITIAL_MESSAGES = 50;
/** How many older messages one "load earlier" brings. */
export const EARLIER_PAGE = 50;
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
  /** What the agent is doing right now, for the working bubble. Null when it is not working or has not said. Never a chat message. */
  readonly agentStatus: string | null;
  /** There are messages before the oldest one here, which "load earlier" can fetch. Only meaningful when the chat is first opened. */
  readonly hasEarlier: boolean;
  /** Every plan the group has made, oldest first, so each card shows its own plan's state. */
  readonly plans: readonly PlanCardDto[];
}

export interface ChatDeps {
  readonly groups: Pick<GroupRepository, "memberNames" | "joinedMembers">;
  readonly messages: Pick<MessageRepository, "listAfter" | "recent">;
  readonly runs: Pick<AgentRunRepository, "activity">;
  readonly plans: Pick<PlanStore, "cards">;
  /** What the cards offer the person asking. */
  readonly viewerCards: Pick<ViewerCards, "forPlan">;
  /** Where the person has read up to, so the trips list can show a chat with newer messages as unread. */
  readonly reads: Pick<ReadMarkers, "markRead">;
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
 * `viewerId` is who is asking: the newest open plan's card also carries what that person can do next, and the messages
 * they are given count as read by them.
 */
export async function loadChat(deps: ChatDeps, groupId: string, window: { readonly afterSeq: number | null; readonly limit: number }, viewerId: string | null = null): Promise<ChatSnapshot> {
  const now = deps.clock();
  const [names, joined, activity, plans, fetched] = await Promise.all([
    deps.groups.memberNames(groupId),
    deps.groups.joinedMembers(groupId),
    deps.runs.activity(groupId, now, AGENT_STALE_MS),
    deps.plans.cards(groupId),
    // One more than asked for, so a chat that holds exactly one page does not claim to have an earlier one.
    window.afterSeq === null ? deps.messages.recent(groupId, window.limit + 1) : deps.messages.listAfter(groupId, window.afterSeq, window.limit),
  ]);
  const hasEarlier = window.afterSeq === null && fetched.length > window.limit;
  const messages = hasEarlier ? fetched.slice(1) : fetched;
  if (viewerId && messages.length > 0) await deps.reads.markRead(viewerId, Math.max(...messages.map((message) => message.seq)));
  const open = viewerId ? newestOpenPlan(plans) : null;
  const mine = open && viewerId ? await deps.viewerCards.forPlan(open.id, viewerId) : null;
  return {
    messages: messages.map((message) => toMessageDto(message, names)),
    members: joined.map((member) => member.displayName),
    agentWorking: activity.working,
    agentStatus: activity.working ? activity.progress : null,
    hasEarlier,
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

export interface EarlierDeps {
  readonly groups: Pick<GroupRepository, "memberNames">;
  readonly messages: Pick<MessageRepository, "listBefore">;
  /** Who is asking, in this group. Null for anyone who is not a member of it. */
  readonly memberOf: (groupId: string) => Promise<Member | null>;
}

export interface EarlierPage {
  readonly messages: readonly ChatMessageDto[];
  /** There are still older messages after these. */
  readonly hasEarlier: boolean;
}

/** Scrolling back: the page of messages just before `before`, which is the oldest the person has. */
export async function handleEarlier(request: Request, groupId: string, deps: EarlierDeps): Promise<Response> {
  const member = isUuid(groupId) ? await deps.memberOf(groupId) : null;
  if (!member) return json({ error: "unauthorized" }, 401);

  const raw = new URL(request.url).searchParams.get("before") ?? "";
  const before = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(before) || before < 1) return json({ error: "bad_before" }, 400);

  const [names, fetched] = await Promise.all([deps.groups.memberNames(groupId), deps.messages.listBefore(groupId, before, EARLIER_PAGE + 1)]);
  const hasEarlier = fetched.length > EARLIER_PAGE;
  const page: EarlierPage = { messages: (hasEarlier ? fetched.slice(1) : fetched).map((message) => toMessageDto(message, names)), hasEarlier };
  return json(page, 200);
}
