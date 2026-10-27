-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Online payment attempts (Small Commercial V1 S11, ADR 0020). Additive: a new type and a new
-- table, nothing existing is touched. Until this runs, the online payment code reports "not
-- available yet" and records nothing.
DO $enum$ BEGIN
	CREATE TYPE "public"."payment_attempt_status" AS ENUM('CREATED', 'REDIRECTED', 'VALIDATED', 'RECORDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'HELD_FOR_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"merchant_tran_id" text NOT NULL,
	"amount_minor_units" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'CREATED' NOT NULL,
	"provider_session_key" text,
	"provider_val_id" text,
	"bank_tran_id" text,
	"risk_level" integer,
	"last_provider_status" text,
	"reason_code" text,
	"initiated_by_account_id" uuid,
	"redirected_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"recorded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_merchant_tran_unique" UNIQUE("merchant_tran_id"),
	CONSTRAINT "payment_attempts_provider_val_unique" UNIQUE("provider","provider_val_id"),
	CONSTRAINT "payment_attempts_amount_positive" CHECK ("payment_attempts"."amount_minor_units" > 0),
	CONSTRAINT "payment_attempts_recorded_has_time" CHECK ("payment_attempts"."status" <> 'RECORDED' or "payment_attempts"."recorded_at" is not null),
	CONSTRAINT "payment_attempts_held_has_reason" CHECK ("payment_attempts"."status" <> 'HELD_FOR_REVIEW' or "payment_attempts"."reason_code" is not null)
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_invoice_idx" ON "payment_attempts" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_status_redirected_idx" ON "payment_attempts" USING btree ("status","redirected_at");
