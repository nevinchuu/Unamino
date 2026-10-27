ALTER TABLE "messages" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "join_token_hash" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "join_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "inputs_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_join_token_hash_unique" UNIQUE("join_token_hash");