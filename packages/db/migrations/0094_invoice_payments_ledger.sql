-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Cash ledger (Small Commercial V1 S10, ADR 0020). Additive: a new type and a new table.
-- The ledger is append-only. A trigger refuses UPDATE, DELETE and TRUNCATE (a raised error,
-- not a silent no-op, so a bug can never lose a change quietly); corrections are new rows.
DO $enum$ BEGIN
	CREATE TYPE "public"."invoice_payment_kind" AS ENUM('ONLINE', 'MANUAL_CLAIM', 'ADMIN_RECORDED', 'CREDIT', 'REFUND');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor_units" integer NOT NULL,
	"currency" text NOT NULL,
	"kind" "invoice_payment_kind" NOT NULL,
	"source_id" uuid,
	"provider" text,
	"provider_transaction_id" text,
	"reference" text NOT NULL,
	"collected_date" timestamp with time zone NOT NULL,
	"recorded_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_kind_source_unique" UNIQUE("kind","source_id"),
	CONSTRAINT "invoice_payments_provider_transaction_unique" UNIQUE("provider","provider_transaction_id"),
	CONSTRAINT "invoice_payments_amount_sign" CHECK (("invoice_payments"."kind" = 'REFUND' and "invoice_payments"."amount_minor_units" < 0) or ("invoice_payments"."kind" <> 'REFUND' and "invoice_payments"."amount_minor_units" > 0)),
	CONSTRAINT "invoice_payments_source_required" CHECK ("invoice_payments"."kind" = 'ADMIN_RECORDED' or "invoice_payments"."source_id" is not null),
	CONSTRAINT "invoice_payments_provider_pair" CHECK (("invoice_payments"."provider" is null) = ("invoice_payments"."provider_transaction_id" is null)),
	CONSTRAINT "invoice_payments_reference_present" CHECK (length(btrim("invoice_payments"."reference")) > 0)
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");
--> statement-breakpoint
-- Opening balance: money recorded before the ledger existed (and any recorded between the
-- deploy and this migration) becomes one ADMIN_RECORDED row per invoice, for exactly the part
-- of the collected total that no ledger row covers yet. Running it again adds nothing, because
-- afterwards every invoice's ledger already equals its collected total.
INSERT INTO "invoice_payments" ("invoice_id", "amount_minor_units", "currency", "kind", "source_id", "reference", "collected_date", "recorded_by_account_id")
SELECT i."id",
	(i."collected_amount_minor_units" - coalesce(l."total", 0))::integer,
	upper(btrim(i."currency")),
	'ADMIN_RECORDED',
	NULL,
	coalesce(nullif(btrim(i."payment_reference"), ''), 'Opening balance'),
	coalesce(i."collected_date", i."updated_at"),
	NULL
FROM "invoices" i
LEFT JOIN (
	SELECT "invoice_id", sum("amount_minor_units") AS "total" FROM "invoice_payments" GROUP BY "invoice_id"
) l ON l."invoice_id" = i."id"
WHERE i."collected_amount_minor_units" > coalesce(l."total", 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_invoice_payments_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	RAISE EXCEPTION 'invoice_payments is append-only: % is not allowed, record a reversing entry instead', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "invoice_payments_append_only_rows" ON "invoice_payments";
--> statement-breakpoint
CREATE TRIGGER "invoice_payments_append_only_rows" BEFORE UPDATE OR DELETE ON "invoice_payments"
	FOR EACH ROW EXECUTE FUNCTION "visastack_invoice_payments_append_only"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "invoice_payments_append_only_truncate" ON "invoice_payments";
--> statement-breakpoint
CREATE TRIGGER "invoice_payments_append_only_truncate" BEFORE TRUNCATE ON "invoice_payments"
	FOR EACH STATEMENT EXECUTE FUNCTION "visastack_invoice_payments_append_only"();
