-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- AI app suggestion tools (S21, ADR 0021 extension "Suggest Changes"). Additive: two new tables
-- (drafts an AI app saved for the person, and which app added a reminder to a case), and a
-- document becomes optional on a suggestion, only for a suggestion an AI app made about the
-- profile itself. Every existing row keeps its document, so nothing written before changes.
-- Until this runs, the three suggestion tools answer "not available yet" and write nothing, the
-- "Suggest Changes" choice is not offered, and everything else works as before.
CREATE TABLE IF NOT EXISTS "ai_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"mission_id" uuid,
	"connection_id" uuid,
	"client_name" text NOT NULL,
	"client_host" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_drafts_title_length" CHECK (char_length("ai_drafts"."title") between 1 and 120),
	CONSTRAINT "ai_drafts_body_length" CHECK (char_length("ai_drafts"."body") between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_task_origins" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid,
	"client_name" text NOT NULL,
	"client_host" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_drafts_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_drafts_mission_id_missions_id_fk') THEN
		ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_drafts_connection_id_ai_connections_id_fk') THEN
		ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_connection_id_ai_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_task_origins_task_id_mission_tasks_id_fk') THEN
		ALTER TABLE "ai_task_origins" ADD CONSTRAINT "ai_task_origins_task_id_mission_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."mission_tasks"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_task_origins_connection_id_ai_connections_id_fk') THEN
		ALTER TABLE "ai_task_origins" ADD CONSTRAINT "ai_task_origins_connection_id_ai_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_drafts_applicant_created_idx" ON "ai_drafts" USING btree ("applicant_id","created_at");
--> statement-breakpoint
-- A run with no document is allowed only for an AI app's suggestion (model version "connector:").
-- Every existing run has a document, so this holds for every row already written.
DO $ck$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_extraction_runs_document_or_connector') THEN
		ALTER TABLE "ai_extraction_runs" ADD CONSTRAINT "ai_extraction_runs_document_or_connector" CHECK ("ai_extraction_runs"."document_version_id" is not null or "ai_extraction_runs"."model_version" like 'connector:%');
	END IF;
END $ck$;
--> statement-breakpoint
-- The same rule for a suggestion, which names its run rather than a model: no document only when
-- its run is a connector run.
CREATE OR REPLACE FUNCTION "field_proposals_document_or_connector"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF NEW."document_version_id" IS NULL AND NOT EXISTS (
		SELECT 1 FROM "ai_extraction_runs" r
		WHERE r."id" = NEW."ai_extraction_run_id" AND r."model_version" LIKE 'connector:%'
	) THEN
		RAISE EXCEPTION 'a suggestion without a document must come from an AI app'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "field_proposals_document_or_connector" ON "field_proposals";
--> statement-breakpoint
CREATE TRIGGER "field_proposals_document_or_connector" BEFORE INSERT OR UPDATE OF "document_version_id", "ai_extraction_run_id" ON "field_proposals"
	FOR EACH ROW EXECUTE FUNCTION "field_proposals_document_or_connector"();
--> statement-breakpoint
-- Last, so the suggestion tools (which look for a document becoming optional) stay off until
-- everything above is in place.
ALTER TABLE "ai_extraction_runs" ALTER COLUMN "document_version_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "field_proposals" ALTER COLUMN "document_version_id" DROP NOT NULL;
