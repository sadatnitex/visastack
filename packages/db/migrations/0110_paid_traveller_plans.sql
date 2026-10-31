-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Paid traveller plans, step T1 (ADR 0025). Additive only: the payer on subscriptions, invoices,
-- payment attempts, refund requests and payment receipts becomes an organization or a person
-- (payer_account_id), never both and never neither, checked by the database. Every existing row
-- is an organization's and keeps it, so nothing written before changes, and every agency query
-- (which filters on organization_id) reads exactly what it read before. Also: a person's own
-- receipt numbering, whether a person's plan renews, and the subscription an invoice pays for.
-- No code reads or writes any of this yet (ADR 0025 section 13): the database gains it first.
-- Each check is added first and validated against every row before organization_id may be
-- empty, so there is no moment when a row could have neither payer. Every statement gives up
-- after 5 seconds rather than queue the site behind a long-running query (run it outside the
-- nightly backup); a statement that gave up is simply run again.
-- Until this runs, readiness reports the database as behind (one migration pending).
CREATE TABLE IF NOT EXISTS "person_receipt_counters" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "person_receipt_counters_not_negative" CHECK ("person_receipt_counters"."last_number" >= 0)
);
--> statement-breakpoint
DO $col$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
	ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "renews" boolean DEFAULT true NOT NULL;
	ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
	ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "subscription_id" uuid;
	ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
	ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
	ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "payer_account_id" uuid;
END $col$;
--> statement-breakpoint
-- One payer per row: added without scanning (NOT VALID), then validated against every row.
DO $ck$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
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
DO $va$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	ALTER TABLE "subscriptions" VALIDATE CONSTRAINT "subscriptions_one_payer";
	ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_one_payer";
	ALTER TABLE "payment_attempts" VALIDATE CONSTRAINT "payment_attempts_one_payer";
	ALTER TABLE "refund_requests" VALIDATE CONSTRAINT "refund_requests_one_payer";
	ALTER TABLE "payment_receipts" VALIDATE CONSTRAINT "payment_receipts_one_payer";
END $va$;
--> statement-breakpoint
-- Only now may organization_id be empty: the checks above already hold for every row.
DO $nn$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	ALTER TABLE "subscriptions" ALTER COLUMN "organization_id" DROP NOT NULL;
	ALTER TABLE "invoices" ALTER COLUMN "organization_id" DROP NOT NULL;
	ALTER TABLE "payment_attempts" ALTER COLUMN "organization_id" DROP NOT NULL;
	ALTER TABLE "refund_requests" ALTER COLUMN "organization_id" DROP NOT NULL;
	ALTER TABLE "payment_receipts" ALTER COLUMN "organization_id" DROP NOT NULL;
END $nn$;
--> statement-breakpoint
DO $fk$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_payer_account_id_accounts_id_fk') THEN
		ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payer_account_id_accounts_id_fk" FOREIGN KEY ("payer_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_subscription_id_subscriptions_id_fk') THEN
		ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_receipts_person_number_unique') THEN
		ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_person_number_unique" UNIQUE("payer_account_id","receipt_number");
	END IF;
END $fk$;
--> statement-breakpoint
-- Indexes. The person unique indexes use the same conditions as the organization ones, so a
-- later "insert or keep" names one plain conflict target; an organization's row (no person)
-- never collides because empty values are never equal.
DO $ix$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_one_current_per_person" ON "subscriptions" USING btree ("payer_account_id") WHERE "subscriptions"."ended_at" is null;
	CREATE INDEX IF NOT EXISTS "subscriptions_payer_idx" ON "subscriptions" USING btree ("payer_account_id");
	CREATE UNIQUE INDEX IF NOT EXISTS "invoices_person_plan_period_unique" ON "invoices" USING btree ("payer_account_id","plan_id","period_start") WHERE "invoices"."status" <> 'VOID';
	CREATE INDEX IF NOT EXISTS "invoices_person_paid_period_idx" ON "invoices" USING btree ("payer_account_id","period_end") WHERE "invoices"."status" = 'PAID' and "invoices"."payer_account_id" is not null;
	CREATE INDEX IF NOT EXISTS "invoices_subscription_idx" ON "invoices" USING btree ("subscription_id");
	CREATE INDEX IF NOT EXISTS "payment_attempts_payer_idx" ON "payment_attempts" USING btree ("payer_account_id");
	CREATE INDEX IF NOT EXISTS "refund_requests_payer_idx" ON "refund_requests" USING btree ("payer_account_id");
END $ix$;
