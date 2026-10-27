-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Agency invoices, manual payment reports and numbered receipts (Small Commercial V1 S12,
-- ADR 0020). Additive: new types and new tables, nothing existing is touched. Until this runs,
-- the code reports "not available yet", reports no claims or receipts and records nothing new.
-- Decided claims and issued receipts cannot be edited or removed (triggers below).
DO $enum$ BEGIN
	CREATE TYPE "public"."manual_claim_method" AS ENUM('BANK_TRANSFER', 'BKASH', 'CHEQUE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;
--> statement-breakpoint
DO $enum$ BEGIN
	CREATE TYPE "public"."manual_claim_status" AS ENUM('SUBMITTED', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_object_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"scan_status" text DEFAULT 'CLEAN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_receipts_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "billing_receipts_storage_object_id_unique" UNIQUE("storage_object_id"),
	CONSTRAINT "billing_receipts_scanned_clean" CHECK ("billing_receipts"."scan_status" = 'CLEAN'),
	CONSTRAINT "billing_receipts_sha256_format" CHECK ("billing_receipts"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "billing_receipts_size_bounds" CHECK ("billing_receipts"."size_bytes" between 1 and 5242880),
	CONSTRAINT "billing_receipts_type" CHECK ("billing_receipts"."content_type" in ('application/pdf', 'image/jpeg', 'image/png'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manual_payment_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"submitted_by_account_id" uuid NOT NULL,
	"method" "manual_claim_method" NOT NULL,
	"reference" text NOT NULL,
	"amount_minor_units" integer NOT NULL,
	"currency" text NOT NULL,
	"paid_on" timestamp with time zone NOT NULL,
	"note" text,
	"status" "manual_claim_status" DEFAULT 'SUBMITTED' NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_payment_claims_amount_positive" CHECK ("manual_payment_claims"."amount_minor_units" > 0),
	CONSTRAINT "manual_payment_claims_reference_bounds" CHECK (length(btrim("manual_payment_claims"."reference")) between 1 and 120),
	CONSTRAINT "manual_payment_claims_note_bounds" CHECK ("manual_payment_claims"."note" is null or length("manual_payment_claims"."note") <= 500),
	CONSTRAINT "manual_payment_claims_decision_shape" CHECK (("manual_payment_claims"."status" = 'SUBMITTED' and "manual_payment_claims"."decided_at" is null and "manual_payment_claims"."decided_by_account_id" is null)
        or ("manual_payment_claims"."status" <> 'SUBMITTED' and "manual_payment_claims"."decided_at" is not null and "manual_payment_claims"."decided_by_account_id" is not null)),
	CONSTRAINT "manual_payment_claims_rejection_has_reason" CHECK ("manual_payment_claims"."status" <> 'REJECTED' or length(btrim(coalesce("manual_payment_claims"."decision_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_receipt_counters" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_receipt_counters_not_negative" CHECK ("payment_receipt_counters"."last_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_payment_id" uuid NOT NULL,
	"receipt_number" integer NOT NULL,
	"amount_minor_units" integer NOT NULL,
	"currency" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_receipts_invoice_payment_id_unique" UNIQUE("invoice_payment_id"),
	CONSTRAINT "payment_receipts_org_number_unique" UNIQUE("organization_id","receipt_number"),
	CONSTRAINT "payment_receipts_number_positive" CHECK ("payment_receipts"."receipt_number" > 0),
	CONSTRAINT "payment_receipts_amount_positive" CHECK ("payment_receipts"."amount_minor_units" > 0)
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "billing_receipts" ADD CONSTRAINT "billing_receipts_claim_id_manual_payment_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."manual_payment_claims"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "billing_receipts" ADD CONSTRAINT "billing_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "billing_receipts" ADD CONSTRAINT "billing_receipts_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "manual_payment_claims" ADD CONSTRAINT "manual_payment_claims_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "manual_payment_claims" ADD CONSTRAINT "manual_payment_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "payment_receipt_counters" ADD CONSTRAINT "payment_receipt_counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_invoice_payment_id_invoice_payments_id_fk" FOREIGN KEY ("invoice_payment_id") REFERENCES "public"."invoice_payments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_receipts_org_idx" ON "billing_receipts" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_payment_claims_invoice_idx" ON "manual_payment_claims" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_payment_claims_org_status_idx" ON "manual_payment_claims" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manual_payment_claims_one_waiting_unique" ON "manual_payment_claims" USING btree ("invoice_id") WHERE "manual_payment_claims"."status" = 'SUBMITTED';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_receipts_invoice_idx" ON "payment_receipts" USING btree ("invoice_id");
--> statement-breakpoint
-- Opening receipts: every collection already in the ledger (except the opening-balance rows,
-- which are not a recording) gets its receipt, numbered per organization in ledger order after
-- any receipt already issued, so numbering stays gap-free. A re-run adds nothing (one receipt per
-- ledger row). The invoice rows are locked while they are read so a payment being recorded at
-- this moment either commits first and is numbered here, or waits and issues its own receipt.
INSERT INTO "payment_receipts" ("organization_id", "invoice_id", "invoice_payment_id", "receipt_number", "amount_minor_units", "currency", "issued_at")
SELECT x."organization_id", x."invoice_id", x."id",
	x."base" + row_number() OVER (PARTITION BY x."organization_id" ORDER BY x."seq"),
	x."amount_minor_units", x."currency", x."created_at"
FROM (
	SELECT i."organization_id", p."invoice_id", p."id", p."seq", p."amount_minor_units", p."currency", p."created_at",
		coalesce((SELECT max(r."receipt_number") FROM "payment_receipts" r WHERE r."organization_id" = i."organization_id"), 0) AS "base"
	FROM "invoice_payments" p
	JOIN "invoices" i ON i."id" = p."invoice_id"
	WHERE p."amount_minor_units" > 0
		AND p."provider" IS DISTINCT FROM 'opening_balance'
		AND NOT EXISTS (SELECT 1 FROM "payment_receipts" r2 WHERE r2."invoice_payment_id" = p."id")
	FOR UPDATE OF i
) x
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "payment_receipt_counters" ("organization_id", "last_number")
SELECT "organization_id", max("receipt_number") FROM "payment_receipts" GROUP BY "organization_id"
ON CONFLICT ("organization_id") DO UPDATE SET "last_number" = GREATEST("payment_receipt_counters"."last_number", EXCLUDED."last_number");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_billing_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "payment_receipts_append_only_rows" ON "payment_receipts";
--> statement-breakpoint
CREATE TRIGGER "payment_receipts_append_only_rows" BEFORE UPDATE OR DELETE ON "payment_receipts"
	FOR EACH ROW EXECUTE FUNCTION "visastack_billing_append_only"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "payment_receipts_append_only_truncate" ON "payment_receipts";
--> statement-breakpoint
CREATE TRIGGER "payment_receipts_append_only_truncate" BEFORE TRUNCATE ON "payment_receipts"
	FOR EACH STATEMENT EXECUTE FUNCTION "visastack_billing_append_only"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "billing_receipts_append_only_rows" ON "billing_receipts";
--> statement-breakpoint
CREATE TRIGGER "billing_receipts_append_only_rows" BEFORE UPDATE OR DELETE ON "billing_receipts"
	FOR EACH ROW EXECUTE FUNCTION "visastack_billing_append_only"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "billing_receipts_append_only_truncate" ON "billing_receipts";
--> statement-breakpoint
CREATE TRIGGER "billing_receipts_append_only_truncate" BEFORE TRUNCATE ON "billing_receipts"
	FOR EACH STATEMENT EXECUTE FUNCTION "visastack_billing_append_only"();
--> statement-breakpoint
-- A claim is decided once. While it waits, only the decision fields may change (the money,
-- the method, the reference, the date, the invoice and the person who reported it are fixed);
-- once decided, nothing changes at all; a claim is never deleted.
CREATE OR REPLACE FUNCTION "visastack_manual_claims_guard"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF TG_OP <> 'UPDATE' THEN
		RAISE EXCEPTION 'manual_payment_claims: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD."status" <> 'SUBMITTED' THEN
		RAISE EXCEPTION 'manual_payment_claims: a decided claim cannot change' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."submitted_by_account_id" IS DISTINCT FROM OLD."submitted_by_account_id"
		OR NEW."method" IS DISTINCT FROM OLD."method"
		OR NEW."reference" IS DISTINCT FROM OLD."reference"
		OR NEW."amount_minor_units" IS DISTINCT FROM OLD."amount_minor_units"
		OR NEW."currency" IS DISTINCT FROM OLD."currency"
		OR NEW."paid_on" IS DISTINCT FROM OLD."paid_on"
		OR NEW."note" IS DISTINCT FROM OLD."note"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'manual_payment_claims: a reported payment cannot be edited' USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "manual_payment_claims_guard_rows" ON "manual_payment_claims";
--> statement-breakpoint
CREATE TRIGGER "manual_payment_claims_guard_rows" BEFORE UPDATE OR DELETE ON "manual_payment_claims"
	FOR EACH ROW EXECUTE FUNCTION "visastack_manual_claims_guard"();
