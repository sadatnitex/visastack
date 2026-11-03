CREATE TABLE "umpe_outcome_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"mission_submission_id" uuid,
	"binding" text NOT NULL,
	"handoff_id" uuid,
	"handoff_checksum" text,
	"mission_snapshot_id" uuid,
	"pack_version_id" uuid,
	"pack_checksum" text,
	"manifest_format" integer,
	"material_revision" integer,
	"selected_versions" jsonb NOT NULL,
	"route_key" text,
	"purpose" text,
	"jurisdiction" text,
	"destination" text,
	"travel_start_date" timestamp with time zone,
	"travel_end_date" timestamp with time zone,
	"channel" text NOT NULL,
	"submitted_on" date NOT NULL,
	"evidence_basis" text NOT NULL,
	"evidence_document_version_id" uuid,
	"recorded_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "umpe_outcome_attempts_mission_no" UNIQUE("mission_id","attempt_no"),
	CONSTRAINT "umpe_outcome_attempts_no_positive" CHECK ("umpe_outcome_attempts"."attempt_no" >= 1),
	CONSTRAINT "umpe_outcome_attempts_binding_known" CHECK ("umpe_outcome_attempts"."binding" in ('PACKAGE_HANDOFF', 'SNAPSHOT_ONLY', 'NONE')),
	CONSTRAINT "umpe_outcome_attempts_channel_known" CHECK ("umpe_outcome_attempts"."channel" in ('EMBASSY_PORTAL', 'EMAIL', 'IN_PERSON', 'COURIER', 'VISA_APPLICATION_CENTER', 'OTHER')),
	CONSTRAINT "umpe_outcome_attempts_basis_known" CHECK ("umpe_outcome_attempts"."evidence_basis" in ('SELF_REPORTED', 'DOCUMENT_SUPPLIED')),
	CONSTRAINT "umpe_outcome_attempts_self_reported_has_no_document" CHECK ("umpe_outcome_attempts"."evidence_basis" <> 'SELF_REPORTED' or "umpe_outcome_attempts"."evidence_document_version_id" is null),
	CONSTRAINT "umpe_outcome_attempts_text_caps" CHECK (coalesce(char_length("umpe_outcome_attempts"."route_key"), 0) <= 200 and coalesce(char_length("umpe_outcome_attempts"."purpose"), 0) <= 500 and coalesce(char_length("umpe_outcome_attempts"."jurisdiction"), 0) <= 500 and coalesce(char_length("umpe_outcome_attempts"."destination"), 0) <= 500)
);
--> statement-breakpoint
CREATE TABLE "umpe_outcome_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"decision" text,
	"request_source" text,
	"requested_doc_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"occurred_on" date NOT NULL,
	"evidence_basis" text NOT NULL,
	"evidence_document_version_id" uuid,
	"recorded_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "umpe_outcome_events_kind_known" CHECK ("umpe_outcome_events"."kind" in ('AUTHORITY_RECEIPT', 'AUTHORITY_REQUEST', 'DECISION')),
	CONSTRAINT "umpe_outcome_events_decision_shape" CHECK (("umpe_outcome_events"."kind" = 'DECISION') = ("umpe_outcome_events"."decision" is not null) and ("umpe_outcome_events"."decision" is null or "umpe_outcome_events"."decision" in ('PENDING', 'APPROVED', 'REFUSED', 'WITHDRAWN', 'CANCELLED', 'OTHER'))),
	CONSTRAINT "umpe_outcome_events_request_shape" CHECK (("umpe_outcome_events"."kind" = 'AUTHORITY_REQUEST') = ("umpe_outcome_events"."request_source" is not null) and ("umpe_outcome_events"."request_source" is null or "umpe_outcome_events"."request_source" in ('EMBASSY_OR_CONSULATE', 'VISA_APPLICATION_CENTER', 'IMMIGRATION_AUTHORITY', 'OTHER_AUTHORITY')) and ("umpe_outcome_events"."kind" = 'AUTHORITY_REQUEST' or cardinality("umpe_outcome_events"."requested_doc_types") = 0) and cardinality("umpe_outcome_events"."requested_doc_types") <= 20),
	CONSTRAINT "umpe_outcome_events_basis_known" CHECK ("umpe_outcome_events"."evidence_basis" in ('SELF_REPORTED', 'DOCUMENT_SUPPLIED')),
	CONSTRAINT "umpe_outcome_events_self_reported_has_no_document" CHECK ("umpe_outcome_events"."evidence_basis" <> 'SELF_REPORTED' or "umpe_outcome_events"."evidence_document_version_id" is null)
);
--> statement-breakpoint
ALTER TABLE "umpe_outcome_attempts" ADD CONSTRAINT "umpe_outcome_attempts_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_attempts" ADD CONSTRAINT "umpe_outcome_attempts_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_attempts" ADD CONSTRAINT "umpe_outcome_attempts_mission_submission_id_mission_submissions_id_fk" FOREIGN KEY ("mission_submission_id") REFERENCES "public"."mission_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_attempts" ADD CONSTRAINT "umpe_outcome_attempts_handoff_id_umpe_package_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."umpe_package_handoffs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_attempts" ADD CONSTRAINT "umpe_outcome_attempts_mission_snapshot_id_mission_snapshots_id_fk" FOREIGN KEY ("mission_snapshot_id") REFERENCES "public"."mission_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_attempts" ADD CONSTRAINT "umpe_outcome_attempts_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_attempts" ADD CONSTRAINT "umpe_outcome_attempts_evidence_document_version_id_document_versions_id_fk" FOREIGN KEY ("evidence_document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_attempts" ADD CONSTRAINT "umpe_outcome_attempts_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_events" ADD CONSTRAINT "umpe_outcome_events_attempt_id_umpe_outcome_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."umpe_outcome_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_events" ADD CONSTRAINT "umpe_outcome_events_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_events" ADD CONSTRAINT "umpe_outcome_events_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_events" ADD CONSTRAINT "umpe_outcome_events_evidence_document_version_id_document_versions_id_fk" FOREIGN KEY ("evidence_document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "umpe_outcome_events" ADD CONSTRAINT "umpe_outcome_events_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "umpe_outcome_attempts_submission_once" ON "umpe_outcome_attempts" USING btree ("mission_submission_id") WHERE "umpe_outcome_attempts"."mission_submission_id" is not null;--> statement-breakpoint
CREATE INDEX "umpe_outcome_attempts_applicant_idx" ON "umpe_outcome_attempts" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_attempts_handoff_idx" ON "umpe_outcome_attempts" USING btree ("handoff_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_attempts_snapshot_idx" ON "umpe_outcome_attempts" USING btree ("mission_snapshot_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_attempts_pack_version_idx" ON "umpe_outcome_attempts" USING btree ("pack_version_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_attempts_evidence_idx" ON "umpe_outcome_attempts" USING btree ("evidence_document_version_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_attempts_recorded_by_idx" ON "umpe_outcome_attempts" USING btree ("recorded_by_account_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_attempts_submitted_idx" ON "umpe_outcome_attempts" USING btree ("submitted_on");--> statement-breakpoint
CREATE INDEX "umpe_outcome_events_attempt_idx" ON "umpe_outcome_events" USING btree ("attempt_id","occurred_on");--> statement-breakpoint
CREATE INDEX "umpe_outcome_events_mission_idx" ON "umpe_outcome_events" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_events_applicant_idx" ON "umpe_outcome_events" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_events_evidence_idx" ON "umpe_outcome_events" USING btree ("evidence_document_version_id");--> statement-breakpoint
CREATE INDEX "umpe_outcome_events_recorded_by_idx" ON "umpe_outcome_events" USING btree ("recorded_by_account_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_umpe_outcome_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
	-- An attempt and what followed it are history: they go only with their case, person, document or
	-- submission report (a cascade, one trigger level down) or with the case purge (below).
	IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
		RETURN OLD;
	END IF;
	-- A removed evidence document leaves the record without its document (ON DELETE SET NULL).
	IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
		AND to_jsonb(NEW) - 'evidence_document_version_id' - 'recorded_by_account_id' - 'handoff_id' - 'mission_snapshot_id' - 'pack_version_id'
			= to_jsonb(OLD) - 'evidence_document_version_id' - 'recorded_by_account_id' - 'handoff_id' - 'mission_snapshot_id' - 'pack_version_id' THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION '%: an application attempt record is never changed or removed', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "umpe_outcome_attempts_append_only" ON "umpe_outcome_attempts";
--> statement-breakpoint
CREATE TRIGGER "umpe_outcome_attempts_append_only" BEFORE UPDATE OR DELETE ON "umpe_outcome_attempts" FOR EACH ROW EXECUTE FUNCTION "visastack_umpe_outcome_guard"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "umpe_outcome_events_append_only" ON "umpe_outcome_events";
--> statement-breakpoint
CREATE TRIGGER "umpe_outcome_events_append_only" BEFORE UPDATE OR DELETE ON "umpe_outcome_events" FOR EACH ROW EXECUTE FUNCTION "visastack_umpe_outcome_guard"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_umpe_outcome_case_purged"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
	-- The case purge redacts the case row and keeps it; its attempts (which copy the case's route,
	-- purpose, place and dates) go with the redaction, so a purged case never returns to a report.
	DELETE FROM "umpe_outcome_attempts" WHERE "mission_id" = NEW."id";
	RETURN NEW;
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "umpe_outcome_case_purged" ON "missions";
--> statement-breakpoint
CREATE TRIGGER "umpe_outcome_case_purged" AFTER UPDATE OF "purged_at" ON "missions" FOR EACH ROW WHEN (NEW."purged_at" IS NOT NULL AND OLD."purged_at" IS NULL) EXECUTE FUNCTION "visastack_umpe_outcome_case_purged"();
