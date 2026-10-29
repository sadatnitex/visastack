-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Recurring period invoices, reminders and overdue handling (S17, ADR 0020 Phase 2). Additive:
-- one new table holding the platform's single row of billing rules, two new columns' worth of
-- meaning on billing status history (a nullable person and a cause), and three indexes. Nothing
-- existing is changed: every history row already written names a person, so it gets cause
-- MANUAL, which is exactly what it was.
-- Until this runs, the daily billing run reports "not available" and creates nothing, the Billing
-- Rules page says the rules are not available yet, and every status change and payment works as
-- before.
-- Before running in production, this must return no rows (two live invoices for the same
-- organization, plan and period start would stop the unique index below from being created):
--   select organization_id, plan_id, period_start, count(*) from invoices
--   where status <> 'VOID' group by 1, 2, 3 having count(*) > 1;
DO $ty$ BEGIN
	CREATE TYPE "public"."billing_status_cause" AS ENUM('MANUAL', 'NONPAYMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"due_days" integer DEFAULT 7 NOT NULL,
	"overdue_handling_enabled" boolean DEFAULT false NOT NULL,
	"grace_after_days" integer,
	"suspend_after_days" integer,
	"invoicing_starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_account_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_settings_singleton" CHECK ("billing_settings"."id"),
	CONSTRAINT "billing_settings_due_days_range" CHECK ("billing_settings"."due_days" between 1 and 60),
	CONSTRAINT "billing_settings_policy_complete" CHECK (not "billing_settings"."overdue_handling_enabled" or ("billing_settings"."grace_after_days" is not null and "billing_settings"."suspend_after_days" is not null)),
	CONSTRAINT "billing_settings_policy_order" CHECK ("billing_settings"."grace_after_days" is null or "billing_settings"."suspend_after_days" is null or ("billing_settings"."grace_after_days" between 0 and 365 and "billing_settings"."suspend_after_days" > "billing_settings"."grace_after_days" and "billing_settings"."suspend_after_days" <= 365))
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_settings_updated_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_updated_by_account_id_accounts_id_fk" FOREIGN KEY ("updated_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
-- The one row of rules, with the standard values: payment due 7 days after a period starts,
-- automatic Grace and Suspended off, and nothing that started before this moment ever billed.
INSERT INTO "billing_settings" ("id") VALUES (true) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "billing_status_history" ALTER COLUMN "actor_account_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "billing_status_history" ADD COLUMN IF NOT EXISTS "cause" "billing_status_cause" DEFAULT 'MANUAL' NOT NULL;
--> statement-breakpoint
DO $ck$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_status_history_system_actor') THEN
		ALTER TABLE "billing_status_history" ADD CONSTRAINT "billing_status_history_system_actor" CHECK ((("billing_status_history"."actor_account_id" is null) = ("billing_status_history"."cause" = 'NONPAYMENT')) and ("billing_status_history"."actor_account_id" is not null or "billing_status_history"."reason" like 'system:%'));
	END IF;
END $ck$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_status_history_latest_idx" ON "billing_status_history" USING btree ("billing_account_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_org_plan_period_unique" ON "invoices" USING btree ("organization_id","plan_id","period_start") WHERE "invoices"."status" <> 'VOID';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_open_due_idx" ON "invoices" USING btree ("due_date") WHERE "invoices"."status" in ('OPEN', 'PARTIALLY_PAID');
