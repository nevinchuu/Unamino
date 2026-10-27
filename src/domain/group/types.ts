export const MAX_GROUP_MEMBERS = 12;
export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_NAME_LENGTH = 40;

export type MemberStatus = "invited" | "joined" | "left";
export type MessageKind = "human" | "agent" | "system";

export interface Group {
  readonly id: string;
  readonly name: string;
  readonly baseCurrency: string;
}

export interface Member {
  readonly id: string;
  readonly groupId: string;
  readonly displayName: string;
  /** The currency this person pays in. */
  readonly currency: string;
  readonly isOrganiser: boolean;
}

/** What someone holding a join link may see before they join: no names beyond who invited them. */
export interface JoinLinkPreview {
  readonly groupId: string;
  readonly groupName: string;
  /** Who made the group. Null only if they cannot be found, which a group never allows. */
  readonly inviterName: string | null;
  readonly memberCount: number;
  readonly isFull: boolean;
}

export interface Message {
  readonly id: string;
  /** One increasing number across all groups, so "newer than" is a single comparison. */
  readonly seq: number;
  readonly groupId: string;
  /** Empty for the agent and for system lines. */
  readonly memberId: string | null;
  readonly kind: MessageKind;
  readonly body: string;
  readonly replyToMessageId: string | null;
  readonly mentionsAgent: boolean;
  /** Set when the agent announces a plan, so the chat can show it inline. */
  readonly planId: string | null;
  readonly createdAt: Date;
}

export type GroupErrorCode =
  | "invalid_input"
  | "invalid_link"
  | "group_full"
  | "not_found"
  | "forbidden"
  | "unavailable";

export interface GroupError {
  readonly code: GroupErrorCode;
  readonly message: string;
}
