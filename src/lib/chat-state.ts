/** The few fields of a message these rules need. */
export interface SeqMessage {
  readonly id: string;
  readonly seq: number;
  readonly senderId: string | null;
  readonly body: string;
}

/**
 * Adds newly polled messages to the ones already held: each message once, oldest first. A message that arrives
 * twice (once from the person's own send, once from a poll) is kept as one, and the newer copy wins.
 */
export function mergeMessages<T extends SeqMessage>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>(existing.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** A message the person has sent that the server has not yet confirmed, or could not take. */
export interface PendingMessage {
  readonly tempId: string;
  readonly body: string;
  readonly replyToId: string | null;
  readonly status: "sending" | "failed";
  /** When the person pressed send, in milliseconds, so the bubble has a time before the server gives it one. */
  readonly sentAt: number;
  /** The newest message the chat held when this was sent. Anything of theirs newer than this with the same words is this message. */
  readonly afterSeq: number;
  readonly error?: string;
}

/**
 * The unconfirmed messages still worth drawing. Once the real message is in the chat the temporary bubble goes, so a
 * poll that delivers it a moment before the send call returns does not show it twice.
 */
export function visiblePending(pending: readonly PendingMessage[], confirmed: readonly SeqMessage[], meId: string): PendingMessage[] {
  return pending.filter(
    (candidate) => candidate.status === "failed" || !confirmed.some((message) => message.senderId === meId && message.seq > candidate.afterSeq && message.body === candidate.body),
  );
}

/** The highest sequence number held, or 0 for an empty chat: the starting point for the next poll. */
export const lastSeq = (messages: readonly SeqMessage[]): number => messages.at(-1)?.seq ?? 0;
