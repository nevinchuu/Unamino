import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { callsAgent } from "@/domain/group/mention";
import { MAX_MESSAGE_LENGTH, type GroupError, type Message, type MessageKind } from "@/domain/group/types";
import type { MessageRepository, NewHumanMessage } from "@/domain/group/repository";
import type { Database } from "./client";
import { members, messages } from "./schema";

type MessageRow = typeof messages.$inferSelect;

const MAX_PAGE = 200;

const failure = (code: GroupError["code"], message: string): Result<never, GroupError> => err({ code, message });

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  seq: row.seq,
  groupId: row.groupId,
  memberId: row.memberId,
  kind: row.kind,
  body: row.body,
  replyToMessageId: row.replyToMessageId,
  mentionsAgent: row.mentionsAgent,
  planId: row.planId,
  createdAt: row.createdAt,
});

const bodyProblem = (body: string): string | null =>
  body.trim().length === 0 ? "A message cannot be empty" : body.length > MAX_MESSAGE_LENGTH ? `A message can be at most ${MAX_MESSAGE_LENGTH} characters` : null;

/**
 * Stores the chat. Whether a message calls the agent is decided here from its text and what it replies to, never
 * taken from the caller, and only people can call it.
 */
export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly db: Database) {}

  async post(input: NewHumanMessage): Promise<Result<Message, GroupError>> {
    const problem = bodyProblem(input.body);
    if (problem) return failure("invalid_input", problem);

    try {
      const [author] = await this.db.select().from(members).where(and(eq(members.id, input.memberId), eq(members.groupId, input.groupId), eq(members.status, "joined"))).limit(1);
      if (!author) return failure("forbidden", "Only people in the group can post");

      let repliesToKind: MessageKind | null = null;
      if (input.replyToMessageId) {
        const [target] = await this.db.select({ kind: messages.kind }).from(messages).where(and(eq(messages.id, input.replyToMessageId), eq(messages.groupId, input.groupId))).limit(1);
        if (!target) return failure("invalid_input", "That message is not in this group");
        repliesToKind = target.kind;
      }

      const body = input.body.trim();
      const [row] = await this.db
        .insert(messages)
        .values({ groupId: input.groupId, memberId: input.memberId, kind: "human", body, replyToMessageId: input.replyToMessageId ?? null, mentionsAgent: callsAgent({ kind: "human", body, repliesToKind }) })
        .returning();
      return ok(toMessage(row));
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  postAgent(groupId: string, body: string, options: { readonly replyToMessageId?: string; readonly planId?: string } = {}): Promise<Result<Message, GroupError>> {
    return this.postBot("agent", groupId, body, options);
  }

  postSystem(groupId: string, body: string): Promise<Result<Message, GroupError>> {
    return this.postBot("system", groupId, body, {});
  }

  async listAfter(groupId: string, afterSeq: number, limit: number): Promise<readonly Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, groupId), gt(messages.seq, afterSeq)))
      .orderBy(asc(messages.seq))
      .limit(Math.min(Math.max(limit, 1), MAX_PAGE));
    return rows.map(toMessage);
  }

  async listBefore(groupId: string, beforeSeq: number, limit: number): Promise<readonly Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, groupId), lt(messages.seq, beforeSeq)))
      .orderBy(desc(messages.seq))
      .limit(Math.min(Math.max(limit, 1), MAX_PAGE));
    return rows.map(toMessage).reverse();
  }

  async recent(groupId: string, limit: number): Promise<readonly Message[]> {
    const rows = await this.db.select().from(messages).where(eq(messages.groupId, groupId)).orderBy(desc(messages.seq)).limit(Math.min(Math.max(limit, 1), MAX_PAGE));
    return rows.map(toMessage).reverse();
  }

  private async postBot(
    kind: "agent" | "system",
    groupId: string,
    body: string,
    options: { readonly replyToMessageId?: string; readonly planId?: string },
  ): Promise<Result<Message, GroupError>> {
    const problem = bodyProblem(body);
    if (problem) return failure("invalid_input", problem);
    try {
      const [row] = await this.db
        .insert(messages)
        .values({ groupId, memberId: null, kind, body: body.trim(), replyToMessageId: options.replyToMessageId ?? null, planId: options.planId ?? null, mentionsAgent: false })
        .returning();
      return ok(toMessage(row));
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }
}
