CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'declined', 'needs_reapproval');--> statement-breakpoint
CREATE TYPE "public"."effect_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('invited', 'joined', 'left');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('human', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."offer_kind" AS ENUM('hotel', 'flight', 'activity');--> statement-breakpoint
CREATE TYPE "public"."plan_agreement" AS ENUM('pending', 'agreed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'reviewing', 'approving', 'held', 'booking', 'booked', 'captured', 'expired');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"trigger_message_id" uuid NOT NULL,
	"requested_by_member_id" uuid,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"model" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_runs_trigger_message_id_unique" UNIQUE("trigger_message_id")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"group_id" uuid NOT NULL,
	"member_id" uuid,
	"kind" "message_kind" NOT NULL,
	"body" text NOT NULL,
	"reply_to_message_id" uuid,
	"mentions_agent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_seq_unique" UNIQUE("seq"),
	CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") BETWEEN 1 AND 4000),
	CONSTRAINT "messages_human_has_author" CHECK ("messages"."kind" <> 'human' OR "messages"."member_id" IS NOT NULL),
	CONSTRAINT "messages_only_humans_call_the_agent" CHECK (NOT "messages"."mentions_agent" OR "messages"."kind" = 'human')
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "member_status" DEFAULT 'invited' NOT NULL,
	"is_organiser" boolean DEFAULT false NOT NULL,
	"invite_token_hash" text NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_invite_token_hash_unique" UNIQUE("invite_token_hash"),
	CONSTRAINT "members_joined_has_time" CHECK ("members"."status" <> 'joined' OR "members"."joined_at" IS NOT NULL),
	CONSTRAINT "members_left_has_time" CHECK ("members"."status" <> 'left' OR "members"."left_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "effect_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"effect_key" text NOT NULL,
	"type" text NOT NULL,
	"status" "effect_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "effect_log_effect_key_unique" UNIQUE("effect_key")
);
--> statement-breakpoint
ALTER TABLE "effect_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_members" (
	"plan_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_agreement" "plan_agreement" DEFAULT 'pending' NOT NULL,
	"agreed_share_minor" bigint,
	"approval" "approval_status" DEFAULT 'pending' NOT NULL,
	"approved_minor" bigint,
	"current_share_minor" bigint,
	"charged_minor" bigint,
	"approval_expires_at" timestamp with time zone,
	"hold_id" text,
	"last_seen_quote" jsonb,
	CONSTRAINT "plan_members_plan_id_member_id_pk" PRIMARY KEY("plan_id","member_id"),
	CONSTRAINT "plan_members_charge_within_cap" CHECK ("plan_members"."charged_minor" IS NULL OR "plan_members"."approved_minor" IS NULL OR "plan_members"."charged_minor" <= "plan_members"."approved_minor")
);
--> statement-breakpoint
ALTER TABLE "plan_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"offer" jsonb NOT NULL,
	"listing_id" text NOT NULL,
	"search_id" uuid,
	"member_ids" jsonb NOT NULL,
	"reason" text NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_picks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"brief_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"deadline_at" timestamp with time zone NOT NULL,
	"hard_deadline_at" timestamp with time zone NOT NULL,
	"base_currency" char(3) NOT NULL,
	"fx" jsonb NOT NULL,
	"headcount" integer NOT NULL,
	"offers_checked_at" timestamp with time zone,
	"recreated_from_plan_id" uuid,
	"replaced_by_plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_version_positive" CHECK ("plans"."version" >= 1),
	CONSTRAINT "plans_deadline_within_cap" CHECK ("plans"."deadline_at" <= "plans"."hard_deadline_at")
);
--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "schedule_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"gap_id" text NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"category" text NOT NULL,
	"why" text NOT NULL,
	"venue" jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "traveller_details" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "traveller_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_constraints" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"constraints" jsonb NOT NULL,
	"source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_constraints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offer_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"kind" "offer_kind" NOT NULL,
	"query" jsonb NOT NULL,
	"guests" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"offer_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"kind" "offer_kind" NOT NULL,
	"offer" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offers_search_offer" UNIQUE("search_id","offer_id")
);
--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"destination_city" text,
	"destination_country" char(2),
	"destination_airport" char(3),
	"origin_airport" char(3),
	"depart_date" date,
	"return_date" date,
	"headcount" integer NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_briefs_group_version" UNIQUE("group_id","version"),
	CONSTRAINT "trip_briefs_headcount_positive" CHECK ("trip_briefs"."headcount" > 0),
	CONSTRAINT "trip_briefs_dates_in_order" CHECK ("trip_briefs"."return_date" IS NULL OR "trip_briefs"."depart_date" IS NULL OR "trip_briefs"."return_date" >= "trip_briefs"."depart_date")
);
--> statement-breakpoint
ALTER TABLE "trip_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_trigger_message_id_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_requested_by_member_id_members_id_fk" FOREIGN KEY ("requested_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effect_log" ADD CONSTRAINT "effect_log_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_members" ADD CONSTRAINT "plan_members_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_members" ADD CONSTRAINT "plan_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_picks" ADD CONSTRAINT "plan_picks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_picks" ADD CONSTRAINT "plan_picks_search_id_offer_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."offer_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_brief_id_trip_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."trip_briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_recreated_from_plan_id_plans_id_fk" FOREIGN KEY ("recreated_from_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_replaced_by_plan_id_plans_id_fk" FOREIGN KEY ("replaced_by_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_suggestions" ADD CONSTRAINT "schedule_suggestions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveller_details" ADD CONSTRAINT "traveller_details_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_constraints" ADD CONSTRAINT "member_constraints_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_searches" ADD CONSTRAINT "offer_searches_brief_id_trip_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."trip_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_search_id_offer_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."offer_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_briefs" ADD CONSTRAINT "trip_briefs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_briefs" ADD CONSTRAINT "trip_briefs_created_by_run_id_agent_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_running_per_group" ON "agent_runs" USING btree ("group_id") WHERE "agent_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "agent_runs_group_idx" ON "agent_runs" USING btree ("group_id","started_at");--> statement-breakpoint
CREATE INDEX "messages_group_seq_idx" ON "messages" USING btree ("group_id","seq");--> statement-breakpoint
CREATE INDEX "members_group_idx" ON "members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_one_organiser_per_group" ON "members" USING btree ("group_id") WHERE "members"."is_organiser";--> statement-breakpoint
CREATE INDEX "plan_picks_plan_idx" ON "plan_picks" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "plans_group_idx" ON "plans" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_replaced_once" ON "plans" USING btree ("recreated_from_plan_id") WHERE "plans"."recreated_from_plan_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "offers_listing_idx" ON "offers" USING btree ("listing_id");