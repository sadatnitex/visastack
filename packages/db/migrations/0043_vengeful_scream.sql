ALTER TABLE "missions" ADD COLUMN "jurisdiction" text;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "service_category" text;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "travel_start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "travel_end_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "target_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "owner_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "manual_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_owner_organization_id_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;