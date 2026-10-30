-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Plans admin, one entitlement resolver and test payments (S29, ADR 0020 S29 amendment).
-- Additive: who a plan is for (audience) and whether it lifts every limit (bypass_limits, which
-- replaces the hard-coded Founding Access key); one row per plan and entitlement in
-- plan_entitlements, copied from the five limit columns (which stay, unchanged); every price a
-- plan has had in plan_prices (append-only), starting with today's price; and TEST or LIVE on
-- every online payment and every ledger row. Production payments were never configured, so every
-- online payment written so far is marked TEST, and the ledger rows that came from them too.
-- Until this runs, plans cannot be changed (the Plans page says so), limits are read from the old
-- columns, online payments cannot be started, and every payment is recorded and counted as before.
-- Before running in production (docs/operations/plans-and-entitlements.md), each of these must
-- return no rows, or the owner confirms what it shows:
--   select key, currency from plans where currency is not null and upper(btrim(currency)) !~ '^[A-Z]{3}$';
--   select key, price_minor_units from plans where key = 'agency_founding_access' and coalesce(price_minor_units, 0) <> 0;
--   select key, name, active from plans order by key;   -- every key except traveller_free is an agency plan
--   select count(*), max(created_at) from payment_attempts;   -- all of these become TEST
DO $ty$ BEGIN
	CREATE TYPE "public"."plan_audience" AS ENUM('AGENCY', 'TRAVELLER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
DO $ty$ BEGIN
	CREATE TYPE "public"."entitlement_per" AS ENUM('PERIOD', 'DAY', 'TOTAL', 'CONCURRENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
DO $ty$ BEGIN
	CREATE TYPE "public"."payment_mode" AS ENUM('TEST', 'LIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
-- Currency codes are stored trimmed and in capitals (S30 already writes them so).
UPDATE "plans" SET "currency" = upper(btrim("currency")) WHERE "currency" IS NOT NULL AND "currency" <> upper(btrim("currency"));
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "audience" "plan_audience" DEFAULT 'AGENCY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "bypass_limits" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "plans" SET "audience" = 'TRAVELLER' WHERE "key" = 'traveller_free' AND "audience" <> 'TRAVELLER';
--> statement-breakpoint
UPDATE "plans" SET "bypass_limits" = true WHERE "key" = 'agency_founding_access' AND coalesce("price_minor_units", 0) = 0 AND NOT "bypass_limits";
--> statement-breakpoint
DO $ck$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plans_bypass_free') THEN
		ALTER TABLE "plans" ADD CONSTRAINT "plans_bypass_free" CHECK (not "plans"."bypass_limits" or coalesce("plans"."price_minor_units", 0) = 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plans_bypass_agency') THEN
		ALTER TABLE "plans" ADD CONSTRAINT "plans_bypass_agency" CHECK (not "plans"."bypass_limits" or "plans"."audience" = 'AGENCY');
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plans_currency_iso') THEN
		ALTER TABLE "plans" ADD CONSTRAINT "plans_currency_iso" CHECK ("plans"."currency" is null or "plans"."currency" ~ '^[A-Z]{3}$');
	END IF;
END $ck$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_entitlements" (
	"plan_id" uuid NOT NULL,
	"key" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"limit_value" bigint,
	"per" "entitlement_per" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_entitlements_plan_id_key_pk" PRIMARY KEY("plan_id","key"),
	CONSTRAINT "plan_entitlements_key_shape" CHECK ("plan_entitlements"."key" ~ '^(seats|invitations|cases_per_period|open_cases|storage_bytes|ai_allowance_units|ai\.[a-z][a-z0-9_]{0,62})$'),
	CONSTRAINT "plan_entitlements_per_matches_key" CHECK (("plan_entitlements"."key" in ('seats', 'invitations', 'open_cases') and "plan_entitlements"."per" = 'CONCURRENT') or ("plan_entitlements"."key" in ('cases_per_period', 'ai_allowance_units') and "plan_entitlements"."per" = 'PERIOD') or ("plan_entitlements"."key" = 'storage_bytes' and "plan_entitlements"."per" = 'TOTAL') or ("plan_entitlements"."key" like 'ai.%' and "plan_entitlements"."per" = 'DAY')),
	CONSTRAINT "plan_entitlements_limit_nonnegative" CHECK ("plan_entitlements"."limit_value" is null or "plan_entitlements"."limit_value" >= 0),
	CONSTRAINT "plan_entitlements_limit_needs_included" CHECK ("plan_entitlements"."included" or "plan_entitlements"."limit_value" is null)
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_entitlements_plan_id_plans_id_fk') THEN
		ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
-- Each plan's rules, exactly as its columns say today (NULL stays "no limit"). Invitations were
-- always counted against the team member limit, so they start from the same number.
INSERT INTO "plan_entitlements" ("plan_id", "key", "included", "limit_value", "per")
SELECT p."id", e."key", true, e."limit_value", e."per"::"entitlement_per"
FROM "plans" p
CROSS JOIN LATERAL (VALUES
	('seats', p."seats_allowed"::bigint, 'CONCURRENT'),
	('invitations', p."seats_allowed"::bigint, 'CONCURRENT'),
	('cases_per_period', p."cases_per_period_allowed"::bigint, 'PERIOD'),
	('open_cases', p."concurrent_open_cases_allowed"::bigint, 'CONCURRENT'),
	('storage_bytes', p."storage_bytes_allowed"::bigint, 'TOTAL'),
	('ai_allowance_units', p."ai_allowance_units_allowed"::bigint, 'PERIOD')
) AS e("key", "limit_value", "per")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The AI features every traveller has today (the FREE tier in packages/core/src/ai-features.ts),
-- now as data on the traveller plan.
INSERT INTO "plan_entitlements" ("plan_id", "key", "included", "limit_value", "per")
SELECT p."id", f."key", true, f."limit_value", 'DAY'::"entitlement_per"
FROM "plans" p
CROSS JOIN (VALUES ('ai.ai_app_suggestions', 15::bigint), ('ai.ai_app_original_files', 30::bigint)) AS f("key", "limit_value")
WHERE p."key" = 'traveller_free'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"price_minor_units" integer,
	"currency" text,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices_plan_effective_unique" UNIQUE("plan_id","effective_from"),
	CONSTRAINT "plan_prices_price_currency_together" CHECK (("plan_prices"."price_minor_units" is null) = ("plan_prices"."currency" is null)),
	CONSTRAINT "plan_prices_price_nonnegative" CHECK ("plan_prices"."price_minor_units" is null or "plan_prices"."price_minor_units" >= 0),
	CONSTRAINT "plan_prices_currency_iso" CHECK ("plan_prices"."currency" is null or "plan_prices"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_prices_plan_id_plans_id_fk') THEN
		ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
-- Today's price of every plan, in effect since long before any billing period.
INSERT INTO "plan_prices" ("plan_id", "price_minor_units", "currency", "effective_from")
SELECT "id", "price_minor_units", "currency", '2000-01-01T00:00:00Z'::timestamptz FROM "plans"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_billing_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "plan_prices_append_only_rows" ON "plan_prices";
--> statement-breakpoint
CREATE TRIGGER "plan_prices_append_only_rows" BEFORE UPDATE OR DELETE ON "plan_prices"
	FOR EACH ROW EXECUTE FUNCTION "visastack_billing_append_only"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "plan_prices_append_only_truncate" ON "plan_prices";
--> statement-breakpoint
CREATE TRIGGER "plan_prices_append_only_truncate" BEFORE TRUNCATE ON "plan_prices"
	FOR EACH STATEMENT EXECUTE FUNCTION "visastack_billing_append_only"();
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "mode" "payment_mode";
--> statement-breakpoint
UPDATE "payment_attempts" SET "mode" = 'TEST' WHERE "mode" IS NULL;
--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "mode" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN IF NOT EXISTS "mode" "payment_mode";
--> statement-breakpoint
-- The ledger is append-only. For the length of this backfill its guard lets exactly one change
-- through: filling in a mode that is still empty, with every other value the same. The strict
-- guard is put back at the end of this file (and a run that stops before then puts it back when
-- it is run again from the top).
CREATE OR REPLACE FUNCTION "visastack_invoice_payments_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF TG_OP = 'UPDATE' AND OLD."mode" IS NULL AND NEW."mode" IS NOT NULL
		AND (to_jsonb(NEW) - 'mode') = (to_jsonb(OLD) - 'mode') THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'invoice_payments is append-only: % is not allowed, record a reversing entry instead', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
-- Online payments and credits take the mode of the online payment they came from.
UPDATE "invoice_payments" p SET "mode" = a."mode"
FROM "payment_attempts" a
WHERE p."mode" IS NULL AND p."kind" IN ('ONLINE', 'CREDIT') AND a."id" = p."source_id";
--> statement-breakpoint
-- A refund takes the mode of the ledger row it gave money back from.
UPDATE "invoice_payments" p SET "mode" = coalesce(src."mode", 'LIVE')
FROM "refund_requests" r
LEFT JOIN "invoice_payments" src ON src."id" = r."invoice_payment_id"
WHERE p."mode" IS NULL AND p."kind" = 'REFUND' AND r."id" = p."source_id";
--> statement-breakpoint
-- Everything else (reported and staff-recorded payments) is real money.
UPDATE "invoice_payments" SET "mode" = 'LIVE' WHERE "mode" IS NULL;
--> statement-breakpoint
ALTER TABLE "invoice_payments" ALTER COLUMN "mode" SET NOT NULL;
--> statement-breakpoint
DO $ck$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_payments_manual_live') THEN
		ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_manual_live" CHECK ("invoice_payments"."kind" not in ('MANUAL_CLAIM', 'ADMIN_RECORDED') or "invoice_payments"."mode" = 'LIVE');
	END IF;
END $ck$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_invoice_payments_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	RAISE EXCEPTION 'invoice_payments is append-only: % is not allowed, record a reversing entry instead', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$fn$;
