ALTER TABLE "groups" ADD COLUMN "creator_key" text;--> statement-breakpoint
CREATE INDEX "groups_creator_idx" ON "groups" USING btree ("creator_key","created_at");