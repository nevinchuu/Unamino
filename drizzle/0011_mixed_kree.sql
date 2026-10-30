CREATE TABLE "booking_records" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"plan_title" text NOT NULL,
	"city" text,
	"depart_date" date,
	"return_date" date,
	"payments" jsonb NOT NULL,
	"suppliers" jsonb NOT NULL,
	"purge_after" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "booking_records_purge_idx" ON "booking_records" USING btree ("purge_after");