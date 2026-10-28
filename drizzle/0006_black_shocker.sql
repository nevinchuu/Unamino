CREATE TABLE "supplier_bookings" (
	"plan_id" uuid NOT NULL,
	"pick_id" uuid NOT NULL,
	"kind" "offer_kind" NOT NULL,
	"booking_id" text NOT NULL,
	"confirmation" text,
	"status" text DEFAULT 'booked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_bookings_plan_id_pick_id_pk" PRIMARY KEY("plan_id","pick_id"),
	CONSTRAINT "supplier_bookings_status" CHECK ("supplier_bookings"."status" IN ('booked', 'cancelling', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "supplier_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_bookings" ADD CONSTRAINT "supplier_bookings_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bookings" ADD CONSTRAINT "supplier_bookings_pick_id_plan_picks_id_fk" FOREIGN KEY ("pick_id") REFERENCES "public"."plan_picks"("id") ON DELETE cascade ON UPDATE no action;