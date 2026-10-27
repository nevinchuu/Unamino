import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, currencyCode, id, instant } from "./columns";
import { memberStatus } from "./enums";

/** The group chat. Everything else hangs off it. */
export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull(),
  baseCurrency: currencyCode("base_currency").notNull(),
  createdAt: createdAt(),
}).enableRLS();

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
    /** Only a hash of the invite token is stored, so a leaked table cannot be used to sign in. */
    inviteTokenHash: text("invite_token_hash").notNull().unique(),
    joinedAt: instant("joined_at"),
    leftAt: instant("left_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("members_group_idx").on(table.groupId),
    uniqueIndex("members_one_organiser_per_group").on(table.groupId).where(sql`${table.isOrganiser}`),
    check("members_joined_has_time", sql`${table.status} <> 'joined' OR ${table.joinedAt} IS NOT NULL`),
    check("members_left_has_time", sql`${table.status} <> 'left' OR ${table.leftAt} IS NOT NULL`),
  ],
).enableRLS();
