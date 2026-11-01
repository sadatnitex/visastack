-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Paid traveller plans, step T6 (ADR 0025 section 12.6): two small tables for the platform
-- owner's traveller plan metrics and health signals. Additive: nothing existing is touched. The
-- daily counts hold how many times Plan & Usage was opened and Get was tapped, never who; the
-- health settings hold the owner's alert thresholds in one row. Until this runs the code finds the
-- tables missing: nothing is counted and the standard thresholds apply.
CREATE TABLE IF NOT EXISTS "traveller_plan_daily_counts" (
	"day" date NOT NULL,
	"event" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "traveller_plan_daily_counts_pk" PRIMARY KEY("day","event"),
	CONSTRAINT "traveller_plan_daily_counts_event" CHECK ("traveller_plan_daily_counts"."event" in ('PLAN_VIEWED', 'GET_TAPPED')),
	CONSTRAINT "traveller_plan_daily_counts_count" CHECK ("traveller_plan_daily_counts"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "traveller_plan_health_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"checkout_success_min_percent" integer DEFAULT 50 NOT NULL,
	"confirmation_max_minutes" integer DEFAULT 15 NOT NULL,
	"stuck_confirming_max" integer DEFAULT 0 NOT NULL,
	"needs_check_max" integer DEFAULT 0 NOT NULL,
	"updated_by_account_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traveller_plan_health_settings_singleton" CHECK ("traveller_plan_health_settings"."id"),
	CONSTRAINT "traveller_plan_health_settings_success_range" CHECK ("traveller_plan_health_settings"."checkout_success_min_percent" between 0 and 100),
	CONSTRAINT "traveller_plan_health_settings_minutes_range" CHECK ("traveller_plan_health_settings"."confirmation_max_minutes" between 1 and 1440),
	CONSTRAINT "traveller_plan_health_settings_counts_range" CHECK ("traveller_plan_health_settings"."stuck_confirming_max" between 0 and 1000 and "traveller_plan_health_settings"."needs_check_max" between 0 and 1000)
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'traveller_plan_health_settings_updated_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "traveller_plan_health_settings" ADD CONSTRAINT "traveller_plan_health_settings_updated_by_account_id_accounts_id_fk" FOREIGN KEY ("updated_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
-- The one row, with the standard thresholds, so the owner only ever changes it.
INSERT INTO "traveller_plan_health_settings" ("id") VALUES (true) ON CONFLICT ("id") DO NOTHING;
