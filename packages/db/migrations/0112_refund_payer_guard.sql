-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Paid traveller plans, step T6 (ADR 0025): the refund guard of migration 0104 also keeps the
-- person who paid fixed. A refund request keeps its payer (the agency, or the person who paid for
-- their own plan) fixed for life, as it keeps its money and its source; and a new refund must
-- name the same payer as the invoice it refunds, so money is only ever returned to whoever paid.
-- Before any person refund can exist (owner decision, 31 Oct 2026). Replacing a function takes no
-- table lock; adding the insert trigger takes a short one, and gives up after 5 seconds rather than
-- make the site wait (one that gave up is run again). Until this runs, readiness reports the
-- database as behind (one migration pending) and refunds for travellers stay unavailable.
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
		OR NEW."payer_account_id" IS DISTINCT FROM OLD."payer_account_id"
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
-- A new refund names exactly the invoice's payer: the same agency, or the same person.
CREATE OR REPLACE FUNCTION "visastack_refund_requests_payer_matches"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
	invoice_organization uuid;
	invoice_payer uuid;
BEGIN
	-- Both payers, or neither: the table's own one-payer check refuses that, with its own words.
	IF num_nonnulls(NEW."organization_id", NEW."payer_account_id") <> 1 THEN
		RETURN NEW;
	END IF;
	SELECT i."organization_id", i."payer_account_id" INTO invoice_organization, invoice_payer
		FROM "invoices" i WHERE i."id" = NEW."invoice_id";
	IF NOT FOUND
		OR NEW."organization_id" IS DISTINCT FROM invoice_organization
		OR NEW."payer_account_id" IS DISTINCT FROM invoice_payer THEN
		RAISE EXCEPTION 'refund_requests: a refund must name the payer of its invoice' USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$fn$;
--> statement-breakpoint
DO $tr$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	IF NOT EXISTS (
		SELECT 1 FROM pg_trigger WHERE tgname = 'refund_requests_payer_matches'
			AND tgrelid = '"refund_requests"'::regclass
	) THEN
		CREATE TRIGGER "refund_requests_payer_matches" BEFORE INSERT ON "refund_requests"
			FOR EACH ROW EXECUTE FUNCTION "visastack_refund_requests_payer_matches"();
	END IF;
END $tr$;
