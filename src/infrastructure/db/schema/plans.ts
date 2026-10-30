import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { SupplierBookingStatus } from "@/domain/booking/ports";
import type { Offer } from "@/domain/offers/schema";
import type { SeenQuote } from "@/domain/quote/types";
import type { VenueFacts } from "@/domain/schedule/venue";
import type { FxRateTable } from "@/domain/split/types";
import { createdAt, currencyCode, id, instant, minor } from "./columns";
import { approvalStatus, effectStatus, offerKind, planAgreement, planStatus } from "./enums";
import { groups, members } from "./groups";
import { offerSearches, tripBriefs } from "./trips";

/**
 * One plan for one group state. When the group changes (a friend joins) a new plan replaces it; a plan is
 * never edited to fit a different set of people. `version` is the optimistic lock: every save says which
 * version it read, and loses if someone else saved first.
 */
export const plans = pgTable(
  "plans",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    briefId: uuid("brief_id").notNull().references(() => tripBriefs.id),
    version: integer("version").notNull().default(1),
    status: planStatus("status").notNull().default("draft"),
    title: text("title").notNull(),
    summary: text("summary"),
    deadlineAt: instant("deadline_at").notNull(),
    hardDeadlineAt: instant("hard_deadline_at").notNull(),
    baseCurrency: currencyCode("base_currency").notNull(),
    fx: jsonb("fx").$type<FxRateTable>().notNull(),
    /** The people in this plan. Compared with the group's current headcount to tell when it is out of date. */
    headcount: integer("headcount").notNull(),
    /** A fingerprint of what the plan was built from (trip, people, constraints), to tell when it is out of date. */
    inputsHash: text("inputs_hash").notNull(),
    offersCheckedAt: instant("offers_checked_at"),
    recreatedFromPlanId: uuid("recreated_from_plan_id").references((): AnyPgColumn => plans.id),
    replacedByPlanId: uuid("replaced_by_plan_id").references((): AnyPgColumn => plans.id),
    createdAt: createdAt(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("plans_group_idx").on(table.groupId, table.createdAt),
    // A plan can be replaced only once.
    uniqueIndex("plans_replaced_once").on(table.recreatedFromPlanId).where(sql`${table.recreatedFromPlanId} IS NOT NULL`),
    check("plans_version_positive", sql`${table.version} >= 1`),
    check("plans_deadline_within_cap", sql`${table.deadlineAt} <= ${table.hardDeadlineAt}`),
  ],
).enableRLS();

/** One row per person in a plan: their step 1 agreement and their step 2 amount and card hold. */
export const planMembers = pgTable(
  "plan_members",
  {
    planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull().references(() => members.id),
    planAgreement: planAgreement("plan_agreement").notNull().default("pending"),
    /** The price the member saw when they agreed to the plan. A later rise is measured against this. */
    agreedShareMinor: minor("agreed_share_minor"),
    approval: approvalStatus("approval").notNull().default("pending"),
    /** The cap: the most this member agreed to pay and the amount held on their card. */
    approvedMinor: minor("approved_minor"),
    currentShareMinor: minor("current_share_minor"),
    chargedMinor: minor("charged_minor"),
    approvalExpiresAt: instant("approval_expires_at"),
    /** Whether a card hold exists for the approved amount. The state machine reads this, not the id. */
    holdPlaced: boolean("hold_placed").notNull().default(false),
    /** The payment provider's id for the hold. Kept after the hold is released until the provider confirms, so it can still be cancelled. */
    holdId: text("hold_id"),
    /**
     * Which hold this member is on. It goes up each time a hold is let go of, and it is part of the key a hold is
     * made with, so asking again gives the same hold but a new approval after a release gives a new one.
     */
    holdAttempt: integer("hold_attempt").notNull().default(0),
    /** What the member last saw, so the next look can show what moved. */
    lastSeenQuote: jsonb("last_seen_quote").$type<SeenQuote>(),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.memberId] }),
    // The cap rule, enforced by the database as well as the state machine: nobody is charged more than they approved.
    check("plan_members_charge_within_cap", sql`${table.chargedMinor} IS NULL OR ${table.approvedMinor} IS NULL OR ${table.chargedMinor} <= ${table.approvedMinor}`),
  ],
).enableRLS();

/**
 * A friend paying some or all of another member's part. The trip total does not change; the money only moves between
 * cards. `amountBaseMinor` is in the plan's base currency; `sharePercent` is a percent of the beneficiary's own part.
 * With neither set it is the beneficiary's whole part.
 */
export const planCovers = pgTable(
  "plan_covers",
  {
    planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    sponsorId: uuid("sponsor_id").notNull().references(() => members.id),
    beneficiaryId: uuid("beneficiary_id").notNull().references(() => members.id),
    amountBaseMinor: minor("amount_base_minor"),
    sharePercent: smallint("share_percent"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.sponsorId, table.beneficiaryId] }),
    check("plan_covers_share_percent_range", sql`${table.sharePercent} IS NULL OR (${table.sharePercent} BETWEEN 1 AND 99 AND ${table.amountBaseMinor} IS NULL)`),
    check("plan_covers_not_self", sql`${table.sponsorId} <> ${table.beneficiaryId}`),
    check("plan_covers_amount_positive", sql`${table.amountBaseMinor} IS NULL OR ${table.amountBaseMinor} > 0`),
  ],
).enableRLS();

/**
 * Why a plan's booking failed: which hotel or flight, and the reason, so the group and Trippy can plan something different.
 * A plan has at most one. It goes when the plan goes. `listingId` lets the same listing be kept out of the next plan.
 */
/** What was bought for the plan. A snapshot of the offer is kept, because offers expire and change. */
export const planPicks = pgTable(
  "plan_picks",
  {
    id: id(),
    planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    offer: jsonb("offer").$type<Offer>().notNull(),
    listingId: text("listing_id").notNull(),
    /** The search that found it, so the same query can be run again to renew it. */
    searchId: uuid("search_id").references(() => offerSearches.id, { onDelete: "set null" }),
    memberIds: jsonb("member_ids").$type<string[]>().notNull(),
    reason: text("reason").notNull(),
    notes: jsonb("notes").$type<Record<string, string>>().notNull().default({}),
  },
  (table) => [index("plan_picks_plan_idx").on(table.planId, table.position)],
).enableRLS();

/** Named places for the free time, each confirmed against Google. Only confirmed ones are ever stored. */
export const scheduleSuggestions = pgTable("schedule_suggestions", {
  id: id(),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  gapId: text("gap_id").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  category: text("category").notNull(),
  /** The agent's reason: the only model-written text shown. */
  why: text("why").notNull(),
  venue: jsonb("venue").$type<VenueFacts>().notNull(),
  checkedAt: instant("checked_at").notNull(),
}).enableRLS();

/** Every action the plan asked the outside world to take, so a retry never charges or books twice. */
export const effectLog = pgTable("effect_log", {
  id: id(),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  /** Built from the plan, the effect and the plan version, so the same effect has the same key. */
  effectKey: text("effect_key").notNull().unique(),
  type: text("type").notNull(),
  status: effectStatus("status").notNull().default("pending"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  /** How many times doing it has failed, so a retry that keeps failing is given up on instead of running for ever. */
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
  completedAt: instant("completed_at"),
}).enableRLS();

/**
 * A booking made with an airline or hotel for one pick of a plan. Kept so it can be cancelled if the plan fails,
 * and so the confirmation can show the supplier's own reference. One per pick.
 */
export const supplierBookings = pgTable(
  "supplier_bookings",
  {
    planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    pickId: uuid("pick_id").notNull().references(() => planPicks.id, { onDelete: "cascade" }),
    kind: offerKind("kind").notNull(),
    bookingId: text("booking_id").notNull(),
    confirmation: text("confirmation"),
    status: text("status").$type<SupplierBookingStatus>().notNull().default("booked"),
    createdAt: createdAt(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.pickId] }),
    check("supplier_bookings_status", sql`${table.status} IN ('booked', 'cancelling', 'cancelled')`),
  ],
).enableRLS();
