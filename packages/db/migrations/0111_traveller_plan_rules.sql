-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Paid traveller plans, step T2 (ADR 0025). The code now declares everything migration 0110
-- added; this adds only what is new: a person who buys a plan for themselves is recorded with no
-- assigning account (so the purchase never stands in the way of deleting their own account),
-- while an organization's subscription still always names who assigned it; and two plan rules
-- for traveller storage (the whole account, and each person kept), counted in total.
-- Every existing subscription is an organization's and names its assigner, so the new check holds
-- for every row before the column may be empty. Every statement gives up after 5 seconds rather
-- than make the site wait (run it outside the nightly backup); one that gave up is run again.
-- Until this runs, readiness reports the database as behind (one migration pending).
DO $ck$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_organization_assigned') THEN
		ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_assigned" CHECK ("subscriptions"."organization_id" is null or "subscriptions"."assigned_by_account_id" is not null) NOT VALID;
	END IF;
END $ck$;
--> statement-breakpoint
DO $va$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	ALTER TABLE "subscriptions" VALIDATE CONSTRAINT "subscriptions_organization_assigned";
	ALTER TABLE "subscriptions" ALTER COLUMN "assigned_by_account_id" DROP NOT NULL;
END $va$;
--> statement-breakpoint
-- Each plan rule is replaced in one statement, so the table is never without it.
DO $pe$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	ALTER TABLE "plan_entitlements" DROP CONSTRAINT IF EXISTS "plan_entitlements_key_shape";
	ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_key_shape" CHECK ("plan_entitlements"."key" ~ '^(seats|invitations|cases_per_period|open_cases|storage_bytes|account_storage_bytes|person_storage_bytes|ai_allowance_units|ai\.[a-z][a-z0-9_]{0,62})$');
	ALTER TABLE "plan_entitlements" DROP CONSTRAINT IF EXISTS "plan_entitlements_per_matches_key";
	ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_per_matches_key" CHECK (("plan_entitlements"."key" in ('seats', 'invitations', 'open_cases') and "plan_entitlements"."per" = 'CONCURRENT') or ("plan_entitlements"."key" in ('cases_per_period', 'ai_allowance_units') and "plan_entitlements"."per" = 'PERIOD') or ("plan_entitlements"."key" in ('storage_bytes', 'account_storage_bytes', 'person_storage_bytes') and "plan_entitlements"."per" = 'TOTAL') or ("plan_entitlements"."key" like 'ai.%' and "plan_entitlements"."per" = 'DAY'));
END $pe$;
