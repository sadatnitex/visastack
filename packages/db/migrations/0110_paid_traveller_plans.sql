-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Paid traveller plans, step T1 (ADR 0025). Additive: the payer on subscriptions, invoices,
-- payment attempts, refund requests and payment receipts becomes an organization or a person
-- (payer_account_id), never both and never neither, checked by the database. Every existing row
-- is an organization's and keeps it, so nothing written before changes, and every agency query
-- (which filters on organization_id) reads exactly what it read before. Also: a person's own
-- receipt numbering, whether a person's plan renews, the subscription an invoice pays for, the
-- assigning account set to null when that account is deleted (so a person who bought for
-- themselves can still delete their account), and two plan rule names for traveller storage.
-- Each check is added first and validated against every existing row before organization_id may
-- be empty, so there is no moment when a row could have neither payer.
-- Until this runs, paid traveller plans report "not available yet" and everything else works as
-- before. Selling stays off (TRAVELLER_PLANS_ENABLED) after it runs.
-- Before running in production (docs/adr/0025-paid-traveller-plans.md), each must return 0:
--   select count(*) from subscriptions where organization_id is null;
--   select count(*) from invoices where organization_id is null;
--   select count(*) from payment_attempts where organization_id is null;
--   select count(*) from refund_requests where organization_id is null;
--   select count(*) from payment_receipts where organization_id is null;
CREATE TABLE IF NOT EXISTS "person_receipt_counters" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "person_receipt_counters_not_negative" CHECK ("person_receipt_counters"."last_number" >= 0)
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "renews" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "subscription_id" uuid;
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
--> statement-breakpoint
-- One payer per row: added without scanning (NOT VALID), then validated against every row.
DO $ck$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_one_payer') THEN
		ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_one_payer" CHECK (num_nonnulls("subscriptions"."organization_id", "subscriptions"."payer_account_id") = 1) NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_one_payer') THEN
		ALTER TABLE "invoices" ADD CONSTRAINT "invoices_one_payer" CHECK (num_nonnulls("invoices"."organization_id", "invoices"."payer_account_id") = 1) NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_one_payer') THEN
		ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_one_payer" CHECK (num_nonnulls("payment_attempts"."organization_id", "payment_attempts"."payer_account_id") = 1) NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_one_payer') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_one_payer" CHECK (num_nonnulls("refund_requests"."organization_id", "refund_requests"."payer_account_id") = 1) NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_receipts_one_payer') THEN
		ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_one_payer" CHECK (num_nonnulls("payment_receipts"."organization_id", "payment_receipts"."payer_account_id") = 1) NOT VALID;
	END IF;
END $ck$;
--> statement-breakpoint
ALTER TABLE "subscriptions" VALIDATE CONSTRAINT "subscriptions_one_payer";
--> statement-breakpoint
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_one_payer";
--> statement-breakpoint
ALTER TABLE "payment_attempts" VALIDATE CONSTRAINT "payment_attempts_one_payer";
--> statement-breakpoint
ALTER TABLE "refund_requests" VALIDATE CONSTRAINT "refund_requests_one_payer";
--> statement-breakpoint
ALTER TABLE "payment_receipts" VALIDATE CONSTRAINT "payment_receipts_one_payer";
--> statement-breakpoint
-- Only now may organization_id be empty: the checks above already hold for every row.
ALTER TABLE "subscriptions" ALTER COLUMN "organization_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "organization_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "organization_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "refund_requests" ALTER COLUMN "organization_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_receipts" ALTER COLUMN "organization_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "assigned_by_account_id" DROP NOT NULL;
--> statement-breakpoint
-- Foreign keys. The assigning account's key is replaced in one statement, so it is never missing.
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_payer_account_id_accounts_id_fk') THEN
		ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payer_account_id_accounts_id_fk" FOREIGN KEY ("payer_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_subscription_id_subscriptions_id_fk') THEN
		ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'subscriptions_assigned_by_account_id_accounts_id_fk' AND confdeltype = 'n'
	) THEN
		ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_assigned_by_account_id_accounts_id_fk";
		ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_assigned_by_account_id_accounts_id_fk" FOREIGN KEY ("assigned_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_one_current_per_person" ON "subscriptions" USING btree ("payer_account_id") WHERE "subscriptions"."ended_at" is null and "subscriptions"."payer_account_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_person_plan_period_unique" ON "invoices" USING btree ("payer_account_id","plan_id","period_start") WHERE "invoices"."status" <> 'VOID' and "invoices"."payer_account_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_person_paid_period_idx" ON "invoices" USING btree ("payer_account_id","period_end") WHERE "invoices"."status" = 'PAID' and "invoices"."payer_account_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_payer_idx" ON "payment_attempts" USING btree ("payer_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_requests_payer_idx" ON "refund_requests" USING btree ("payer_account_id");
--> statement-breakpoint
DO $uq$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_receipts_person_number_unique') THEN
		ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_person_number_unique" UNIQUE("payer_account_id","receipt_number");
	END IF;
END $uq$;
--> statement-breakpoint
-- Plan rule names: two for traveller storage. Each rule is replaced in one statement, so the
-- table is never without it.
DO $pe$ BEGIN
	ALTER TABLE "plan_entitlements" DROP CONSTRAINT IF EXISTS "plan_entitlements_key_shape";
	ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_key_shape" CHECK ("plan_entitlements"."key" ~ '^(seats|invitations|cases_per_period|open_cases|storage_bytes|account_storage_bytes|person_storage_bytes|ai_allowance_units|ai\.[a-z][a-z0-9_]{0,62})$');
	ALTER TABLE "plan_entitlements" DROP CONSTRAINT IF EXISTS "plan_entitlements_per_matches_key";
	ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_per_matches_key" CHECK (("plan_entitlements"."key" in ('seats', 'invitations', 'open_cases') and "plan_entitlements"."per" = 'CONCURRENT') or ("plan_entitlements"."key" in ('cases_per_period', 'ai_allowance_units') and "plan_entitlements"."per" = 'PERIOD') or ("plan_entitlements"."key" in ('storage_bytes', 'account_storage_bytes', 'person_storage_bytes') and "plan_entitlements"."per" = 'TOTAL') or ("plan_entitlements"."key" like 'ai.%' and "plan_entitlements"."per" = 'DAY'));
END $pe$;
