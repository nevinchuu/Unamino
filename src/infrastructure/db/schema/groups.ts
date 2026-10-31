import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, currencyCode, id, instant } from "./columns";
import { memberStatus } from "./enums";

/** The group chat. Everything else hangs off it. */
export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull(),
  baseCurrency: currencyCode("base_currency").notNull(),
  /** Only a hash of the shared join link's secret is stored. Anyone holding the link can join while it is enabled. */
  joinTokenHash: text("join_token_hash").unique(),
  joinEnabled: boolean("join_enabled").notNull().default(true),
  /** Who made the group, as a keyed hash of their network address, only so one person cannot make groups without limit. Null when the address was not known. It goes when the group does. */
  creatorKey: text("creator_key"),
  /** Set only by the demo that shows a booking falling through: booking ends with a pretend failure after the hotel is really booked, so the undoing can be seen. */
  demoFailure: boolean("demo_failure").notNull().default(false),
  createdAt: createdAt(),
}, (table) => [index("groups_creator_idx").on(table.creatorKey, table.createdAt)]).enableRLS();

/**
 * A person in a group. The headcount used for every search is the number of `joined` members; names live
 * only here, and the AI is given member ids.
 */
export const members = pgTable(
  "members",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    /** The currency this person pays in. */
    currency: currencyCode("currency").notNull(),
    status: memberStatus("status").notNull().default("invited"),
    isOrganiser: boolean("is_organiser").notNull().default(false),
    /**
     * Hash of this member's personal token, issued when they create or join the group and kept in their browser.
     * Only the hash is stored, so a leaked table cannot be used to sign in. (Named for the earlier per-person invite idea.)
     */
    inviteTokenHash: text("invite_token_hash").notNull().unique(),
    /** Set for a simulated test persona, which a judge adds from the chat to try the app alone. Null for a real person. */
    personaKey: text("persona_key"),
    /** The `seq` of the newest message this person has had on screen. A message after it is unread. */
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
    joinedAt: instant("joined_at"),
    leftAt: instant("left_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("members_group_idx").on(table.groupId),
    uniqueIndex("members_one_organiser_per_group").on(table.groupId).where(sql`${table.isOrganiser}`),
    uniqueIndex("members_one_persona_per_group").on(table.groupId, table.personaKey).where(sql`${table.personaKey} IS NOT NULL AND ${table.status} = 'joined'`),
    check("members_joined_has_time", sql`${table.status} <> 'joined' OR ${table.joinedAt} IS NOT NULL`),
    check("members_left_has_time", sql`${table.status} <> 'left' OR ${table.leftAt} IS NOT NULL`),
  ],
).enableRLS();
