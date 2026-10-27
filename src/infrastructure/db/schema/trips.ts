import { sql } from "drizzle-orm";
import { char, check, date, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import type { MemberConstraints } from "@/domain/constraints/schema";
import type { OfferQuery } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import { agentRuns } from "./chat";
import { createdAt, id, instant } from "./columns";
import { offerKind } from "./enums";
import { groups, members } from "./groups";

/**
 * What the group has said about where and when, as far as the agent understood it. A new row (version) is
 * written whenever it changes, and a plan points at the version it was built from.
 */
export const tripBriefs = pgTable(
  "trip_briefs",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    destinationCity: text("destination_city"),
    destinationCountry: char("destination_country", { length: 2 }),
    destinationAirport: char("destination_airport", { length: 3 }),
    originAirport: char("origin_airport", { length: 3 }),
    departDate: date("depart_date", { mode: "string" }),
    returnDate: date("return_date", { mode: "string" }),
    /** The joined members when this brief was made. This is the party size for every search. */
    headcount: integer("headcount").notNull(),
    /** Which messages each fact came from, so a wrong date can be traced to what was said. */
    evidence: jsonb("evidence").$type<Record<string, string[]>>().notNull().default({}),
    /** What the agent still needs to know, asked in the chat as ordinary messages. */
    openQuestions: jsonb("open_questions").$type<string[]>().notNull().default([]),
    createdByRunId: uuid("created_by_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("trip_briefs_group_version").on(table.groupId, table.version),
    check("trip_briefs_headcount_positive", sql`${table.headcount} > 0`),
    check("trip_briefs_dates_in_order", sql`${table.returnDate} IS NULL OR ${table.departDate} IS NULL OR ${table.returnDate} >= ${table.departDate}`),
  ],
).enableRLS();

/** What one member asked for, read from their own messages only. */
export const memberConstraints = pgTable("member_constraints", {
  memberId: uuid("member_id").primaryKey().references(() => members.id, { onDelete: "cascade" }),
  constraints: jsonb("constraints").$type<MemberConstraints>().notNull(),
  sourceMessageIds: jsonb("source_message_ids").$type<string[]>().notNull().default([]),
  updatedAt: instant("updated_at").notNull().defaultNow(),
}).enableRLS();

/** One search that was run for a brief, kept so the offers can be checked again later with the same query. */
export const offerSearches = pgTable("offer_searches", {
  id: id(),
  briefId: uuid("brief_id").notNull().references(() => tripBriefs.id, { onDelete: "cascade" }),
  kind: offerKind("kind").notNull(),
  query: jsonb("query").$type<OfferQuery>().notNull(),
  guests: integer("guests").notNull(),
  fetchedAt: instant("fetched_at").notNull().defaultNow(),
}).enableRLS();

/** Every offer a search returned, not only the picked ones, so alternatives can be shown. */
export const offers = pgTable(
  "offers",
  {
    id: id(),
    searchId: uuid("search_id").notNull().references(() => offerSearches.id, { onDelete: "cascade" }),
    /** The offer's own id, which changes on every search. */
    offerId: text("offer_id").notNull(),
    /** Stays the same for the same hotel room, flight journey or activity, and is what refresh matches on. */
    listingId: text("listing_id").notNull(),
    kind: offerKind("kind").notNull(),
    offer: jsonb("offer").$type<Offer>().notNull(),
    expiresAt: instant("expires_at").notNull(),
  },
  (table) => [unique("offers_search_offer").on(table.searchId, table.offerId), index("offers_listing_idx").on(table.listingId)],
).enableRLS();
