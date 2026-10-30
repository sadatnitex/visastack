-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Refunds, credits and the monthly accounting export (Small Commercial V1 S18, ADR 0020 Phase 2
-- and its S18 amendment). Additive: one new value on the payment attempt status, two new types,
-- one new table with its guard trigger, and four indexes. Nothing existing is changed.
-- Until this runs, the refund and credit screens say "Refunds are not available yet.", nothing
-- crashes, and the accounting export still works (the ledger exists since 0094).
-- Before running in production, this must return 0 (no refund or credit has ever been written,
-- so nothing written before this migration needs a refund request behind it):
--   select count(*) from invoice_payments where kind in ('REFUND', 'CREDIT');
-- The new attempt status gets its own statement and is never used in the statement that adds it.
ALTER TYPE "public"."payment_attempt_status" ADD VALUE IF NOT EXISTS 'REFUNDED';
--> statement-breakpoint
DO $ty$ BEGIN
	CREATE TYPE "public"."refund_status" AS ENUM('REQUESTED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
DO $ty$ BEGIN
	CREATE TYPE "public"."refund_method" AS ENUM('PROVIDER', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_payment_id" uuid,
	"payment_attempt_id" uuid,
	"method" "refund_method" NOT NULL,
	"status" "refund_status" DEFAULT 'REQUESTED' NOT NULL,
	"amount_minor_units" integer NOT NULL,
	"currency" text NOT NULL,
	"provider" text,
	"provider_refund_id" text,
	"bank_tran_id" text,
	"idempotency_key" uuid NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"failure_code" text,
	"requested_by_account_id" uuid NOT NULL,
	"provider_refunded_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Every constraint is added on its own, only when missing, so a run stopped after the table was
-- made still ends with all of them.
DO $ck$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_idempotency_unique') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_idempotency_unique" UNIQUE("idempotency_key");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_provider_refund_unique') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_provider_refund_unique" UNIQUE("provider","provider_refund_id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_one_source') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_one_source" CHECK (("refund_requests"."invoice_payment_id" is null) <> ("refund_requests"."payment_attempt_id" is null));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_amount_positive') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_amount_positive" CHECK ("refund_requests"."amount_minor_units" > 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_currency_code') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_currency_code" CHECK ("refund_requests"."currency" ~ '^[A-Z]{3}$');
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_reason_bounds') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_reason_bounds" CHECK (length(btrim("refund_requests"."reason")) between 1 and 500);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_manual_shape') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_manual_shape" CHECK ("refund_requests"."method" = 'PROVIDER' or ("refund_requests"."status" = 'CONFIRMED' and "refund_requests"."provider" is null and length(btrim(coalesce("refund_requests"."reference", ''))) between 1 and 120));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_sent_has_ref') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_sent_has_ref" CHECK ("refund_requests"."method" = 'MANUAL' or "refund_requests"."status" in ('REQUESTED', 'CANCELLED', 'FAILED') or "refund_requests"."provider_refund_id" is not null);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_confirmed_time') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_confirmed_time" CHECK ("refund_requests"."status" <> 'CONFIRMED' or "refund_requests"."confirmed_at" is not null);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_failed_code') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_failed_code" CHECK ("refund_requests"."status" <> 'FAILED' or "refund_requests"."failure_code" is not null);
	END IF;
END $ck$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_organization_id_organizations_id_fk') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_invoice_id_invoices_id_fk') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_invoice_payment_id_invoice_payments_id_fk') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_payment_id_invoice_payments_id_fk" FOREIGN KEY ("invoice_payment_id") REFERENCES "public"."invoice_payments"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refund_requests_payment_attempt_id_payment_attempts_id_fk') THEN
		ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_requests_open_idx" ON "refund_requests" USING btree ("status") WHERE "refund_requests"."status" in ('REQUESTED', 'SUBMITTED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_requests_payment_idx" ON "refund_requests" USING btree ("invoice_payment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_requests_attempt_idx" ON "refund_requests" USING btree ("payment_attempt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_created_idx" ON "invoice_payments" USING btree ("created_at");
--> statement-breakpoint
-- A refund request keeps its money, its source, its method, its idempotency key and the person
-- who asked fixed for life. While it is open (REQUESTED or SUBMITTED) only its progress may move
-- (status, the gateway's refund reference, times and codes); once it is final (CONFIRMED,
-- FAILED or CANCELLED) nothing changes at all. A request is never deleted.
CREATE OR REPLACE FUNCTION "visastack_refund_requests_guard"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF TG_OP <> 'UPDATE' THEN
		RAISE EXCEPTION 'refund_requests: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD."status" IN ('CONFIRMED', 'FAILED', 'CANCELLED') THEN
		RAISE EXCEPTION 'refund_requests: a final refund cannot change' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id"
		OR NEW."invoice_payment_id" IS DISTINCT FROM OLD."invoice_payment_id"
		OR NEW."payment_attempt_id" IS DISTINCT FROM OLD."payment_attempt_id"
		OR NEW."method" IS DISTINCT FROM OLD."method"
		OR NEW."amount_minor_units" IS DISTINCT FROM OLD."amount_minor_units"
		OR NEW."currency" IS DISTINCT FROM OLD."currency"
		OR NEW."provider" IS DISTINCT FROM OLD."provider"
		OR NEW."bank_tran_id" IS DISTINCT FROM OLD."bank_tran_id"
		OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
		OR NEW."reason" IS DISTINCT FROM OLD."reason"
		OR NEW."requested_by_account_id" IS DISTINCT FROM OLD."requested_by_account_id"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'refund_requests: the money and the source of a refund cannot be edited' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD."provider_refund_id" IS NOT NULL AND NEW."provider_refund_id" IS DISTINCT FROM OLD."provider_refund_id" THEN
		RAISE EXCEPTION 'refund_requests: the gateway refund reference cannot be replaced' USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "refund_requests_guard_rows" ON "refund_requests";
--> statement-breakpoint
CREATE TRIGGER "refund_requests_guard_rows" BEFORE UPDATE OR DELETE ON "refund_requests"
	FOR EACH ROW EXECUTE FUNCTION "visastack_refund_requests_guard"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "refund_requests_guard_truncate" ON "refund_requests";
--> statement-breakpoint
CREATE TRIGGER "refund_requests_guard_truncate" BEFORE TRUNCATE ON "refund_requests"
	FOR EACH STATEMENT EXECUTE FUNCTION "visastack_refund_requests_guard"();
