-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Trip package assembly (UMPE P4): three new tables, nothing existing is touched.
-- umpe_package_choices keeps what a traveller chose for each requirement of a case (Use This Copy
-- pins an exact document or fact version; Exclude drops an item that can never block, with a
-- reason; Leave Missing keeps the gap). Append-only: a new choice supersedes the live one.
-- umpe_package_handoffs keeps each explicit Prepared for Handoff confirmation, frozen: a trigger
-- refuses every edit except the account reference being cleared when an account is removed.
-- umpe_package_changes keeps at most one open "something changed" item per case.
-- Until this runs the code finds the tables missing and cases behave exactly as before.
CREATE TABLE IF NOT EXISTS "umpe_package_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"signature" text NOT NULL,
	"detail" jsonb NOT NULL,
	"change_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	CONSTRAINT "umpe_package_changes_kind_known" CHECK ("umpe_package_changes"."kind" in ('NEWER_DOCUMENT', 'FACT_CHANGED', 'EVIDENCE_EXPIRED', 'PACK_CHANGED', 'PACK_WITHDRAWN', 'SOURCE_CHANGING')),
	CONSTRAINT "umpe_package_changes_source_known" CHECK ("umpe_package_changes"."source" in ('CASE_OPENED', 'SWEEP')),
	CONSTRAINT "umpe_package_changes_resolution_known" CHECK (("umpe_package_changes"."resolved_at" is null) = ("umpe_package_changes"."resolution" is null) and ("umpe_package_changes"."resolution" is null or "umpe_package_changes"."resolution" in ('REVIEWED', 'NO_LONGER_APPLIES'))),
	CONSTRAINT "umpe_package_changes_signature_cap" CHECK (char_length("umpe_package_changes"."signature") <= 512),
	CONSTRAINT "umpe_package_changes_count_positive" CHECK ("umpe_package_changes"."change_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "umpe_package_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"pack_requirement_id" uuid NOT NULL,
	"choice" text NOT NULL,
	"document_id" uuid,
	"document_version_id" uuid,
	"fact_id" uuid,
	"fact_version_id" uuid,
	"reason" text,
	"chosen_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "umpe_package_choices_choice_known" CHECK ("umpe_package_choices"."choice" in ('USE_COPY', 'EXCLUDE', 'LEAVE_MISSING')),
	CONSTRAINT "umpe_package_choices_copy_shape" CHECK (("umpe_package_choices"."choice" = 'USE_COPY') = (("umpe_package_choices"."document_version_id" is not null and "umpe_package_choices"."document_id" is not null and "umpe_package_choices"."fact_version_id" is null and "umpe_package_choices"."fact_id" is null) or ("umpe_package_choices"."fact_version_id" is not null and "umpe_package_choices"."fact_id" is not null and "umpe_package_choices"."document_version_id" is null and "umpe_package_choices"."document_id" is null))),
	CONSTRAINT "umpe_package_choices_exclude_reason" CHECK ("umpe_package_choices"."choice" <> 'EXCLUDE' or char_length(coalesce("umpe_package_choices"."reason", '')) between 1 and 500),
	CONSTRAINT "umpe_package_choices_reason_cap" CHECK ("umpe_package_choices"."reason" is null or char_length("umpe_package_choices"."reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "umpe_package_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"mission_snapshot_id" uuid NOT NULL,
	"pack_version_id" uuid,
	"pack_checksum" text,
	"manifest_format" integer,
	"material_revision_at_capture" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_checksum" text NOT NULL,
	"confirmed_by_account_id" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "umpe_package_handoffs_checksum_shape" CHECK ("umpe_package_handoffs"."content_checksum" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_changes_mission_id_missions_id_fk') THEN
		ALTER TABLE "umpe_package_changes" ADD CONSTRAINT "umpe_package_changes_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_changes_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "umpe_package_changes" ADD CONSTRAINT "umpe_package_changes_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_choices_mission_id_missions_id_fk') THEN
		ALTER TABLE "umpe_package_choices" ADD CONSTRAINT "umpe_package_choices_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_choices_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "umpe_package_choices" ADD CONSTRAINT "umpe_package_choices_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_choices_pack_requirement_id_pack_requirements_id_fk') THEN
		ALTER TABLE "umpe_package_choices" ADD CONSTRAINT "umpe_package_choices_pack_requirement_id_pack_requirements_id_fk" FOREIGN KEY ("pack_requirement_id") REFERENCES "public"."pack_requirements"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_choices_document_id_documents_id_fk') THEN
		ALTER TABLE "umpe_package_choices" ADD CONSTRAINT "umpe_package_choices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_choices_document_version_id_document_versions_id_fk') THEN
		ALTER TABLE "umpe_package_choices" ADD CONSTRAINT "umpe_package_choices_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_choices_fact_id_facts_id_fk') THEN
		ALTER TABLE "umpe_package_choices" ADD CONSTRAINT "umpe_package_choices_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_choices_fact_version_id_fact_versions_id_fk') THEN
		ALTER TABLE "umpe_package_choices" ADD CONSTRAINT "umpe_package_choices_fact_version_id_fact_versions_id_fk" FOREIGN KEY ("fact_version_id") REFERENCES "public"."fact_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_choices_chosen_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_package_choices" ADD CONSTRAINT "umpe_package_choices_chosen_by_account_id_accounts_id_fk" FOREIGN KEY ("chosen_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_handoffs_mission_id_missions_id_fk') THEN
		ALTER TABLE "umpe_package_handoffs" ADD CONSTRAINT "umpe_package_handoffs_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_handoffs_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "umpe_package_handoffs" ADD CONSTRAINT "umpe_package_handoffs_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_handoffs_mission_snapshot_id_mission_snapshots_id_fk') THEN
		ALTER TABLE "umpe_package_handoffs" ADD CONSTRAINT "umpe_package_handoffs_mission_snapshot_id_mission_snapshots_id_fk" FOREIGN KEY ("mission_snapshot_id") REFERENCES "public"."mission_snapshots"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_handoffs_pack_version_id_pack_versions_id_fk') THEN
		ALTER TABLE "umpe_package_handoffs" ADD CONSTRAINT "umpe_package_handoffs_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_package_handoffs_confirmed_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_package_handoffs" ADD CONSTRAINT "umpe_package_handoffs_confirmed_by_account_id_accounts_id_fk" FOREIGN KEY ("confirmed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "umpe_package_changes_open" ON "umpe_package_changes" USING btree ("mission_id") WHERE "umpe_package_changes"."resolved_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_changes_applicant_idx" ON "umpe_package_changes" USING btree ("applicant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "umpe_package_choices_live" ON "umpe_package_choices" USING btree ("mission_id","pack_requirement_id") WHERE "umpe_package_choices"."superseded_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_choices_applicant_idx" ON "umpe_package_choices" USING btree ("applicant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_choices_requirement_idx" ON "umpe_package_choices" USING btree ("pack_requirement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_choices_document_version_idx" ON "umpe_package_choices" USING btree ("document_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_choices_fact_version_idx" ON "umpe_package_choices" USING btree ("fact_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_choices_document_idx" ON "umpe_package_choices" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_choices_fact_idx" ON "umpe_package_choices" USING btree ("fact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_choices_chosen_by_idx" ON "umpe_package_choices" USING btree ("chosen_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_handoffs_mission_idx" ON "umpe_package_handoffs" USING btree ("mission_id","confirmed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_handoffs_applicant_idx" ON "umpe_package_handoffs" USING btree ("applicant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_handoffs_snapshot_idx" ON "umpe_package_handoffs" USING btree ("mission_snapshot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_handoffs_pack_version_idx" ON "umpe_package_handoffs" USING btree ("pack_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_package_handoffs_confirmed_by_idx" ON "umpe_package_handoffs" USING btree ("confirmed_by_account_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_umpe_package_handoffs_frozen"() RETURNS trigger
LANGUAGE plpgsql AS $frozen$
BEGIN
	IF (to_jsonb(NEW) - 'confirmed_by_account_id') IS DISTINCT FROM (to_jsonb(OLD) - 'confirmed_by_account_id')
		OR (NEW."confirmed_by_account_id" IS NOT NULL AND NEW."confirmed_by_account_id" IS DISTINCT FROM OLD."confirmed_by_account_id") THEN
		RAISE EXCEPTION 'a handoff record cannot be changed' USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$frozen$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "umpe_package_handoffs_frozen_rows" ON "umpe_package_handoffs";
--> statement-breakpoint
CREATE TRIGGER "umpe_package_handoffs_frozen_rows" BEFORE UPDATE ON "umpe_package_handoffs"
	FOR EACH ROW EXECUTE FUNCTION "visastack_umpe_package_handoffs_frozen"();
