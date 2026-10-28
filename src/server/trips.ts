import type { PlanStore } from "@/domain/agent/ports";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { ReadMarkers } from "@/domain/group/read-markers";
import type { Member } from "@/domain/group/types";
import { hasDoneTheirPart, type CardPerson } from "@/lib/plan-card";
import { latestPlan, previewOf, tripStatus, type TripStatus } from "@/lib/trip-list";
import { AGENT_NAME } from "./chat";
import { authenticateInGroup } from "./authenticate";
import type { Membership } from "./member-cookie";
import type { ViewerCards } from "./viewer-card";

/** A browser keeps a group's cookie for 30 days, even after the group is gone, so most cookies may be dead. Only this many of the newest are even checked. */
const MAX_COOKIES_CHECKED = 60;
/** The most cards the list draws. */
const MAX_TRIPS = 20;

export interface TripDto {
  readonly groupId: string;
  readonly name: string;
  /** The last message as one line, or null for a group nobody has written in. */
  readonly preview: string | null;
  /** ISO time of the last message. */
  readonly at: string | null;
  /** A message from someone else that this person has not had on screen. */
  readonly unread: boolean;
  /** Everyone in the group; `done` marks those who have done their part of the plan's current stage. */
  readonly people: readonly { readonly name: string; readonly done: boolean }[];
  readonly status: TripStatus | null;
}

export interface TripsDeps {
  readonly groups: Pick<GroupRepository, "authenticate" | "find" | "joinedMembers" | "memberNames">;
  readonly messages: Pick<MessageRepository, "recent">;
  readonly plans: Pick<PlanStore, "cards">;
  readonly viewerCards: Pick<ViewerCards, "forPlan">;
  readonly reads: Pick<ReadMarkers, "lastRead">;
}

/**
 * The trips list for one browser: a card for each group whose member cookie still opens it, newest activity first.
 * A cookie that no longer opens its group (the person left, or the group is gone) is simply left out.
 */
export async function loadTrips(deps: TripsDeps, memberships: readonly Membership[]): Promise<TripDto[]> {
  // Dead cookies are dropped before the cap, so a pile of old ones can never push a live group off the list. A browser lists its cookies oldest first, so the newest are kept.
  const checked = await Promise.all(memberships.slice(-MAX_COOKIES_CHECKED).map(async ({ groupId, token }) => ({ groupId, me: await authenticateInGroup(deps.groups, groupId, token) })));
  const open = checked.flatMap(({ groupId, me }) => (me ? [{ groupId, me }] : [])).slice(-MAX_TRIPS);

  const cards = await Promise.all(open.map(({ groupId, me }) => tripFor(deps, groupId, me)));
  return cards
    .filter((card): card is TripDto => card !== null)
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "") || a.name.localeCompare(b.name));
}

async function tripFor(deps: TripsDeps, groupId: string, me: Member): Promise<TripDto | null> {
  const [group, joined, names, latest, plans, read] = await Promise.all([
    deps.groups.find(groupId),
    deps.groups.joinedMembers(groupId),
    deps.groups.memberNames(groupId),
    deps.messages.recent(groupId, 1),
    deps.plans.cards(groupId),
    deps.reads.lastRead([me.id]),
  ]);
  if (!group.ok) return null;

  const plan = latestPlan(plans);
  // Who has done their part is only worked out while the plan is still being agreed to or paid for.
  const standing: readonly CardPerson[] = plan && (plan.status === "reviewing" || plan.status === "approving") ? ((await deps.viewerCards.forPlan(plan.id, me.id))?.people ?? []) : [];
  const doneNames = new Set(plan ? standing.filter((person) => hasDoneTheirPart(plan.status, person)).map((person) => person.name) : []);

  const last = latest.at(-1) ?? null;
  const mine = last !== null && last.kind === "human" && last.memberId === me.id;
  const senderName = last === null ? null : last.kind === "agent" ? AGENT_NAME : last.kind === "system" ? null : (names.get(last.memberId ?? "") ?? "Someone");
  return {
    groupId,
    name: group.value.name,
    preview: last === null ? null : previewOf({ kind: last.kind, senderName, mine, body: last.body }),
    at: last?.createdAt.toISOString() ?? null,
    unread: last !== null && !mine && last.seq > (read.get(me.id) ?? 0),
    people: joined.map((member) => ({ name: member.displayName, done: doneNames.has(member.displayName) })),
    status: tripStatus(plan, standing),
  };
}
