import type { Result } from "@/lib/result";
import type { Group, GroupError, JoinLinkPreview, Member, Message } from "./types";

export interface NewGroup {
  readonly name: string;
  readonly baseCurrency: string;
  readonly organiser: { readonly displayName: string; readonly currency: string };
}

export interface CreatedGroup {
  readonly group: Group;
  readonly organiser: Member;
  /** Kept in the organiser's browser. Shown once; only its hash is stored. */
  readonly memberToken: string;
  /** The shared link's secret. Shown once; only its hash is stored. */
  readonly joinToken: string;
}

export interface JoinedGroup {
  readonly group: Group;
  readonly member: Member;
  readonly memberToken: string;
}

export interface GroupRepository {
  create(input: NewGroup): Promise<Result<CreatedGroup, GroupError>>;
  /** Anyone holding the link joins by giving a name and a currency, while the link is enabled and the group has room. */
  joinWithLink(joinToken: string, person: { readonly displayName: string; readonly currency: string }): Promise<Result<JoinedGroup, GroupError>>;
  /** Looks at a join link without using it. Fails with "invalid_link" if it is unknown or switched off. */
  describeJoinLink(joinToken: string): Promise<Result<JoinLinkPreview, GroupError>>;
  /** Who is acting? Only members who are currently in the group are recognised. */
  authenticate(memberToken: string): Promise<Result<Member, GroupError>>;
  find(groupId: string): Promise<Result<Group, GroupError>>;
  /** Everyone who was ever in the group, by id, so old messages keep the name of someone who has since left. */
  memberNames(groupId: string): Promise<ReadonlyMap<string, string>>;
  /** The people in the group right now, in the order they joined. This is the headcount for every search. */
  joinedMembers(groupId: string): Promise<readonly Member[]>;
  leave(memberId: string): Promise<Result<void, GroupError>>;
  /** Organiser only. A new link replaces the old one and turns joining back on. Returns the new secret, once. */
  replaceJoinLink(groupId: string, actingMemberId: string): Promise<Result<string, GroupError>>;
  /** Organiser only. Nobody new can join until the link is replaced. */
  disableJoinLink(groupId: string, actingMemberId: string): Promise<Result<void, GroupError>>;
}

export interface NewHumanMessage {
  readonly groupId: string;
  readonly memberId: string;
  readonly body: string;
  readonly replyToMessageId?: string;
}

export interface MessageRepository {
  /** A person's message. The server decides whether it calls the agent. */
  post(input: NewHumanMessage): Promise<Result<Message, GroupError>>;
  postAgent(groupId: string, body: string, options?: { readonly replyToMessageId?: string; readonly planId?: string }): Promise<Result<Message, GroupError>>;
  postSystem(groupId: string, body: string): Promise<Result<Message, GroupError>>;
  /** Messages newer than `afterSeq`, oldest first. For polling. */
  listAfter(groupId: string, afterSeq: number, limit: number): Promise<readonly Message[]>;
  /** The latest messages, oldest first. For the agent to read. */
  recent(groupId: string, limit: number): Promise<readonly Message[]>;
}
