CREATE TABLE "plan_covers" (
	"plan_id" uuid NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"amount_base_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_covers_plan_id_sponsor_id_beneficiary_id_pk" PRIMARY KEY("plan_id","sponsor_id","beneficiary_id"),
	CONSTRAINT "plan_covers_not_self" CHECK ("plan_covers"."sponsor_id" <> "plan_covers"."beneficiary_id"),
	CONSTRAINT "plan_covers_amount_positive" CHECK ("plan_covers"."amount_base_minor" IS NULL OR "plan_covers"."amount_base_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "plan_covers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_covers" ADD CONSTRAINT "plan_covers_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_covers" ADD CONSTRAINT "plan_covers_sponsor_id_members_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_covers" ADD CONSTRAINT "plan_covers_beneficiary_id_members_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;