CREATE TABLE "booking_failures" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"part_kind" text,
	"part_title" text,
	"listing_id" text,
	"offered_minor" bigint,
	"currency" char(3),
	"retryable" boolean NOT NULL,
	"undone" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_failures_reason" CHECK ("booking_failures"."reason" IN ('price', 'unavailable', 'rejected', 'temporary', 'details', 'hold', 'deadline', 'stuck', 'other'))
);
--> statement-breakpoint
ALTER TABLE "booking_failures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booking_failures" ADD CONSTRAINT "booking_failures_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_failures_created_idx" ON "booking_failures" USING btree ("created_at");