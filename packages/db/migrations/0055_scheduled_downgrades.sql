CREATE TYPE "public"."downgrade_status" AS ENUM('PENDING', 'CANCELLED', 'EXECUTED');--> statement-breakpoint
CREATE TABLE "scheduled_downgrades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_plan_id" uuid NOT NULL,
	"to_plan_id" uuid NOT NULL,
	"status" "downgrade_status" DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"requested_by_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_account_id" uuid,
	"cancelled_reason" text,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_downgrades_effective_after_requested" CHECK ("scheduled_downgrades"."effective_at" > "scheduled_downgrades"."requested_at")
);
--> statement-breakpoint
ALTER TABLE "scheduled_downgrades" ADD CONSTRAINT "scheduled_downgrades_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_downgrades" ADD CONSTRAINT "scheduled_downgrades_from_plan_id_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_downgrades" ADD CONSTRAINT "scheduled_downgrades_to_plan_id_plans_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_downgrades" ADD CONSTRAINT "scheduled_downgrades_requested_by_account_id_accounts_id_fk" FOREIGN KEY ("requested_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_downgrades" ADD CONSTRAINT "scheduled_downgrades_cancelled_by_account_id_accounts_id_fk" FOREIGN KEY ("cancelled_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_downgrades_organization_idx" ON "scheduled_downgrades" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduled_downgrades_status_effective_idx" ON "scheduled_downgrades" USING btree ("status","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_downgrades_pending_unique_idx" ON "scheduled_downgrades" USING btree ("organization_id") WHERE "scheduled_downgrades"."status" = 'PENDING';