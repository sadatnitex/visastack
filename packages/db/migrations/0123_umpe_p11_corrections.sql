-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Checklist corrections and published-rule change impact (UMPE P11): three new tables, nothing
-- existing is touched.
-- umpe_checklist_corrections keeps suggestions from travellers and agencies for pack editors. A
-- suggestion is never a rule: deciding one records the decision only.
-- umpe_rule_impact_runs keeps one assessment per published pack version (no person column).
-- umpe_rule_impacts keeps each affected active case of that version with its one precise item.
-- Until this runs the code finds the tables missing and behaves exactly as before.
CREATE TABLE IF NOT EXISTS "umpe_checklist_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"pack_version_id" uuid NOT NULL,
	"pack_requirement_id" uuid,
	"category" text NOT NULL,
	"official_url" text,
	"detail" text,
	"submitter_kind" text NOT NULL,
	"submitted_by_account_id" uuid,
	"organization_id" uuid,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"reviewer_account_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "umpe_checklist_corrections_category_known" CHECK ("umpe_checklist_corrections"."category" in ('MISSING', 'OUTDATED', 'WRONG', 'WRONG_NECESSITY', 'ALTERNATIVE_ACCEPTED', 'SOURCE_DISCREPANCY', 'OTHER')),
	CONSTRAINT "umpe_checklist_corrections_submitter_known" CHECK ("umpe_checklist_corrections"."submitter_kind" in ('TRAVELLER', 'AGENCY')),
	CONSTRAINT "umpe_checklist_corrections_status_known" CHECK ("umpe_checklist_corrections"."status" in ('RECEIVED', 'IN_REVIEW', 'DISMISSED', 'ACCEPTED_FOR_DRAFT')),
	CONSTRAINT "umpe_checklist_corrections_url_https" CHECK ("umpe_checklist_corrections"."official_url" is null or ("umpe_checklist_corrections"."official_url" like 'https://%' and char_length("umpe_checklist_corrections"."official_url") <= 2048)),
	CONSTRAINT "umpe_checklist_corrections_text_caps" CHECK (coalesce(char_length("umpe_checklist_corrections"."detail"), 0) <= 1000 and coalesce(char_length("umpe_checklist_corrections"."review_note"), 0) <= 1000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "umpe_rule_impact_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"pack_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assessed_at" timestamp with time zone,
	"cases_flagged" integer DEFAULT 0 NOT NULL,
	"notes_queued" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "umpe_rule_impact_runs_pack_version_id_unique" UNIQUE("pack_version_id"),
	CONSTRAINT "umpe_rule_impact_runs_counts_non_negative" CHECK ("umpe_rule_impact_runs"."cases_flagged" >= 0 and "umpe_rule_impact_runs"."notes_queued" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "umpe_rule_impacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"pack_version_id" uuid NOT NULL,
	"previous_pack_version_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"mission_id" uuid,
	"collection_request_id" uuid,
	"organization_id" uuid,
	"change_kind" text NOT NULL,
	"item_kind" text,
	"item_key" text,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	CONSTRAINT "umpe_rule_impacts_case" UNIQUE("pack_version_id","mission_id"),
	CONSTRAINT "umpe_rule_impacts_request" UNIQUE("pack_version_id","collection_request_id"),
	CONSTRAINT "umpe_rule_impacts_subject_shape" CHECK (("umpe_rule_impacts"."subject_kind" = 'CASE' and "umpe_rule_impacts"."mission_id" is not null and "umpe_rule_impacts"."collection_request_id" is null) or ("umpe_rule_impacts"."subject_kind" = 'AGENCY_REQUEST' and "umpe_rule_impacts"."collection_request_id" is not null and "umpe_rule_impacts"."organization_id" is not null and "umpe_rule_impacts"."mission_id" is null)),
	CONSTRAINT "umpe_rule_impacts_change_known" CHECK ("umpe_rule_impacts"."change_kind" in ('ADDED', 'CHANGED', 'REMOVED', 'NONE') and ("umpe_rule_impacts"."item_kind" is null or "umpe_rule_impacts"."item_kind" in ('FIELD', 'DOCUMENT'))),
	CONSTRAINT "umpe_rule_impacts_item_cap" CHECK ("umpe_rule_impacts"."item_key" is null or char_length("umpe_rule_impacts"."item_key") <= 300),
	CONSTRAINT "umpe_rule_impacts_count_non_negative" CHECK ("umpe_rule_impacts"."changed_count" >= 0),
	CONSTRAINT "umpe_rule_impacts_resolution_known" CHECK (("umpe_rule_impacts"."resolved_at" is null) = ("umpe_rule_impacts"."resolution" is null) and ("umpe_rule_impacts"."resolution" is null or "umpe_rule_impacts"."resolution" in ('SUPERSEDED', 'NO_LONGER_APPLIES')))
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_checklist_corrections_pack_id_packs_id_fk') THEN
		ALTER TABLE "umpe_checklist_corrections" ADD CONSTRAINT "umpe_checklist_corrections_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_checklist_corrections_pack_version_id_pack_versions_id_fk') THEN
		ALTER TABLE "umpe_checklist_corrections" ADD CONSTRAINT "umpe_checklist_corrections_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_checklist_corrections_pack_requirement_id_pack_requirements_id_fk') THEN
		ALTER TABLE "umpe_checklist_corrections" ADD CONSTRAINT "umpe_checklist_corrections_pack_requirement_id_pack_requirements_id_fk" FOREIGN KEY ("pack_requirement_id") REFERENCES "public"."pack_requirements"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_checklist_corrections_submitted_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_checklist_corrections" ADD CONSTRAINT "umpe_checklist_corrections_submitted_by_account_id_accounts_id_fk" FOREIGN KEY ("submitted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_checklist_corrections_organization_id_organizations_id_fk') THEN
		ALTER TABLE "umpe_checklist_corrections" ADD CONSTRAINT "umpe_checklist_corrections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_checklist_corrections_reviewer_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_checklist_corrections" ADD CONSTRAINT "umpe_checklist_corrections_reviewer_account_id_accounts_id_fk" FOREIGN KEY ("reviewer_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_rule_impact_runs_pack_id_packs_id_fk') THEN
		ALTER TABLE "umpe_rule_impact_runs" ADD CONSTRAINT "umpe_rule_impact_runs_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_rule_impact_runs_pack_version_id_pack_versions_id_fk') THEN
		ALTER TABLE "umpe_rule_impact_runs" ADD CONSTRAINT "umpe_rule_impact_runs_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_rule_impacts_run_id_umpe_rule_impact_runs_id_fk') THEN
		ALTER TABLE "umpe_rule_impacts" ADD CONSTRAINT "umpe_rule_impacts_run_id_umpe_rule_impact_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."umpe_rule_impact_runs"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_rule_impacts_pack_version_id_pack_versions_id_fk') THEN
		ALTER TABLE "umpe_rule_impacts" ADD CONSTRAINT "umpe_rule_impacts_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_rule_impacts_previous_pack_version_id_pack_versions_id_fk') THEN
		ALTER TABLE "umpe_rule_impacts" ADD CONSTRAINT "umpe_rule_impacts_previous_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("previous_pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_rule_impacts_mission_id_missions_id_fk') THEN
		ALTER TABLE "umpe_rule_impacts" ADD CONSTRAINT "umpe_rule_impacts_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_rule_impacts_collection_request_id_agency_collection_requests_id_fk') THEN
		ALTER TABLE "umpe_rule_impacts" ADD CONSTRAINT "umpe_rule_impacts_collection_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("collection_request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_rule_impacts_organization_id_organizations_id_fk') THEN
		ALTER TABLE "umpe_rule_impacts" ADD CONSTRAINT "umpe_rule_impacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_checklist_corrections_status_idx" ON "umpe_checklist_corrections" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_checklist_corrections_pack_idx" ON "umpe_checklist_corrections" USING btree ("pack_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_checklist_corrections_version_idx" ON "umpe_checklist_corrections" USING btree ("pack_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_checklist_corrections_requirement_idx" ON "umpe_checklist_corrections" USING btree ("pack_requirement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_checklist_corrections_submitter_idx" ON "umpe_checklist_corrections" USING btree ("submitted_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_checklist_corrections_org_idx" ON "umpe_checklist_corrections" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_checklist_corrections_reviewer_idx" ON "umpe_checklist_corrections" USING btree ("reviewer_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_rule_impact_runs_pack_idx" ON "umpe_rule_impact_runs" USING btree ("pack_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_rule_impact_runs_pending_idx" ON "umpe_rule_impact_runs" USING btree ("created_at") WHERE "umpe_rule_impact_runs"."assessed_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_rule_impacts_run_idx" ON "umpe_rule_impacts" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_rule_impacts_previous_idx" ON "umpe_rule_impacts" USING btree ("previous_pack_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_rule_impacts_mission_idx" ON "umpe_rule_impacts" USING btree ("mission_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_rule_impacts_request_idx" ON "umpe_rule_impacts" USING btree ("collection_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_rule_impacts_org_idx" ON "umpe_rule_impacts" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_rule_impacts_unnotified_idx" ON "umpe_rule_impacts" USING btree ("run_id") WHERE "umpe_rule_impacts"."notified_at" is null and "umpe_rule_impacts"."resolved_at" is null;