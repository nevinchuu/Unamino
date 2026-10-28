ALTER TABLE "members" ADD COLUMN "last_read_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Everyone already in a group counts as having read what is there now, so no old chat shows as unread.
UPDATE "members" SET "last_read_seq" = COALESCE((SELECT MAX("seq") FROM "messages" WHERE "messages"."group_id" = "members"."group_id"), 0);
