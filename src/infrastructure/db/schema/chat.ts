import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt, id, instant } from "./columns";
import { agentRunStatus, messageKind } from "./enums";
import { groups, members } from "./groups";

export const MAX_MESSAGE_LENGTH = 4_000;

export const messages = pgTable(
  "messages",
  {
    id: id(),
    /** A single increasing number, so messages have one order everywhere and clients can ask for "newer than". */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull().unique(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    /** Empty for the agent and for system lines. */
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    kind: messageKind("kind").notNull(),
    body: text("body").notNull(),
    replyToMessageId: uuid("reply_to_message_id").references((): AnyPgColumn => messages.id, { onDelete: "set null" }),
    /** Decided by the server from the text, never by the client. Only human messages can call the agent. */
    mentionsAgent: boolean("mentions_agent").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index("messages_group_seq_idx").on(table.groupId, table.seq),
    check("messages_body_length", sql`char_length(${table.body}) BETWEEN 1 AND ${sql.raw(String(MAX_MESSAGE_LENGTH))}`),
    check("messages_human_has_author", sql`${table.kind} <> 'human' OR ${table.memberId} IS NOT NULL`),
    check("messages_only_humans_call_the_agent", sql`NOT ${table.mentionsAgent} OR ${table.kind} = 'human'`),
  ],
).enableRLS();

/** One call to the agent: why it ran, what it cost, and how it ended. */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    /** Each message that calls the agent is handled once. */
    triggerMessageId: uuid("trigger_message_id").notNull().unique().references(() => messages.id, { onDelete: "cascade" }),
    requestedByMemberId: uuid("requested_by_member_id").references(() => members.id, { onDelete: "set null" }),
    status: agentRunStatus("status").notNull().default("running"),
    model: text("model"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    /** Part of the completion tokens, billed as output. */
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    errorCode: text("error_code"),
    startedAt: instant("started_at").notNull().defaultNow(),
    finishedAt: instant("finished_at"),
  },
  (table) => [
    // At most one run at a time per group, so two people calling the agent cannot plan over each other.
    uniqueIndex("agent_runs_one_running_per_group").on(table.groupId).where(sql`${table.status} = 'running'`),
    index("agent_runs_group_idx").on(table.groupId, table.startedAt),
  ],
).enableRLS();
