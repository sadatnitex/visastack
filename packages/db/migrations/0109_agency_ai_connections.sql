-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Agency AI connectors (S22, ADR 0021 S22 amendment), second of two steps. Additive: the agency's
-- own AI setting ("AI Connections for This Agency", off when there is no row), and the agency an
-- agency AI connection speaks for. An agency connection reaches many travellers, so its
-- ai_connections row names no record: applicant_id becomes optional, and a trigger keeps it null
-- exactly when the connection names an agency. Every existing connection keeps its record and
-- names no agency, so nothing written before changes.
-- Until this runs, no agency connection can be made, the agency setting reads as not available
-- yet, and everything else works as before. After it runs, Agency AI Tools stays off until the
-- platform owner turns it on in AI Features, and each agency's setting stays off (no row is
-- written here).
CREATE TABLE IF NOT EXISTS "organization_ai_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"ai_connections_enabled" boolean DEFAULT false NOT NULL,
	"updated_by_account_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_connection_agencies" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_ai_settings_organization_id_organizations_id_fk') THEN
		ALTER TABLE "organization_ai_settings" ADD CONSTRAINT "organization_ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_ai_settings_updated_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "organization_ai_settings" ADD CONSTRAINT "organization_ai_settings_updated_by_account_id_accounts_id_fk" FOREIGN KEY ("updated_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_connection_agencies_connection_id_ai_connections_id_fk') THEN
		ALTER TABLE "ai_connection_agencies" ADD CONSTRAINT "ai_connection_agencies_connection_id_ai_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_connection_agencies_organization_id_organizations_id_fk') THEN
		ALTER TABLE "ai_connection_agencies" ADD CONSTRAINT "ai_connection_agencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_connection_agencies_organization_idx" ON "ai_connection_agencies" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "ai_connections" ALTER COLUMN "applicant_id" DROP NOT NULL;
--> statement-breakpoint
-- A connection names a record or an agency, never both and never neither: applicant_id is null
-- exactly when an ai_connection_agencies row exists. Checked at the end of the transaction, so a
-- connection and its agency row can be written one after the other.
CREATE OR REPLACE FUNCTION "visastack_ai_connection_kind_guard"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
	target uuid;
	record_id uuid;
	present boolean;
BEGIN
	IF TG_TABLE_NAME = 'ai_connections' THEN
		target := NEW."id";
	ELSIF TG_OP = 'DELETE' THEN
		target := OLD."connection_id";
	ELSE
		target := NEW."connection_id";
	END IF;
	SELECT c."applicant_id" INTO record_id FROM "ai_connections" c WHERE c."id" = target;
	IF NOT FOUND THEN
		RETURN NULL;
	END IF;
	SELECT EXISTS (SELECT 1 FROM "ai_connection_agencies" a WHERE a."connection_id" = target)
		INTO present;
	IF (record_id IS NULL) <> present THEN
		RAISE EXCEPTION 'an AI connection names either a record or an agency'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NULL;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ai_connections_kind_guard" ON "ai_connections";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ai_connections_kind_guard" AFTER INSERT OR UPDATE OF "applicant_id" ON "ai_connections"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION "visastack_ai_connection_kind_guard"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ai_connection_agencies_kind_guard" ON "ai_connection_agencies";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ai_connection_agencies_kind_guard" AFTER INSERT OR UPDATE OR DELETE ON "ai_connection_agencies"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION "visastack_ai_connection_kind_guard"();
--> statement-breakpoint
-- An agency connection belongs to its agency: removing its agency row (directly, or when the
-- agency itself is removed) removes the connection too, at once, before the check above runs.
CREATE OR REPLACE FUNCTION "visastack_ai_connection_agency_removed"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	DELETE FROM "ai_connections" c WHERE c."id" = OLD."connection_id" AND c."applicant_id" IS NULL;
	RETURN NULL;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ai_connection_agencies_removed" ON "ai_connection_agencies";
--> statement-breakpoint
CREATE TRIGGER "ai_connection_agencies_removed" AFTER DELETE ON "ai_connection_agencies"
	FOR EACH ROW EXECUTE FUNCTION "visastack_ai_connection_agency_removed"();
--> statement-breakpoint
-- An agency row never moves to another connection or another agency.
CREATE OR REPLACE FUNCTION "visastack_ai_connection_agency_fixed"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF NEW."connection_id" IS DISTINCT FROM OLD."connection_id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id" THEN
		RAISE EXCEPTION 'an agency connection keeps its connection and its agency'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ai_connection_agencies_fixed" ON "ai_connection_agencies";
--> statement-breakpoint
CREATE TRIGGER "ai_connection_agencies_fixed" BEFORE UPDATE ON "ai_connection_agencies"
	FOR EACH ROW EXECUTE FUNCTION "visastack_ai_connection_agency_fixed"();
