-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Resource lifecycle (LC-F, docs/architecture/resource-lifecycle-contract.md): archive, Recently
-- Deleted, support-reviewed removal of a file, and the Removal Record people keep. Additive: four
-- new tables, one new erasure reason and one guard on the removal record; nothing existing is
-- touched. Until this runs the code finds the tables missing and behaves exactly as before, with
-- every lifecycle action hidden. No new column holds a name, a title, a document number, typed
-- text, a file or a raw hash.
ALTER TYPE "public"."erasure_job_reason" ADD VALUE IF NOT EXISTS 'DOCUMENT_REMOVAL';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applicant_lifecycle" (
	"applicant_id" uuid PRIMARY KEY NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_account_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_account_id" uuid,
	"purge_after" timestamp with time zone,
	"receipt_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicant_lifecycle_deleted_together" CHECK (("applicant_lifecycle"."deleted_at" is null) = ("applicant_lifecycle"."purge_after" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_code" text NOT NULL,
	"document_kind" text,
	"uploaded_at" timestamp with time zone,
	"uploaded_by_role" text,
	"path" text NOT NULL,
	"requested_by_account_id" uuid,
	"approved_by_account_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"scheduled_for" timestamp with time zone,
	"verified_gone_at" timestamp with time zone,
	"status" text NOT NULL,
	"effects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_receipts_subject_kind_known" CHECK ("deletion_receipts"."subject_kind" in ('DOCUMENT', 'TRAVELLER')),
	CONSTRAINT "deletion_receipts_subject_code_shape" CHECK ("deletion_receipts"."subject_code" ~ '^[DP]-[0-9A-HJKMNP-TV-Z]{6,8}$'),
	CONSTRAINT "deletion_receipts_uploaded_by_role_known" CHECK ("deletion_receipts"."uploaded_by_role" is null or "deletion_receipts"."uploaded_by_role" in ('OWNER', 'AGENCY_MEMBER', 'CONTRIBUTOR', 'SYSTEM')),
	CONSTRAINT "deletion_receipts_path_known" CHECK ("deletion_receipts"."path" in ('DUPLICATE', 'REQUEST', 'EMPTY_TRAVELLER')),
	CONSTRAINT "deletion_receipts_status_known" CHECK ("deletion_receipts"."status" in ('SCHEDULED', 'RESTORED', 'REMOVING', 'REMOVED', 'BLOCKED')),
	CONSTRAINT "deletion_receipts_effects_object" CHECK (jsonb_typeof("deletion_receipts"."effects") = 'object')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_lifecycle" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"applicant_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_account_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_account_id" uuid,
	"delete_path" text,
	"purge_after" timestamp with time zone,
	"receipt_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_lifecycle_delete_path_known" CHECK ("document_lifecycle"."delete_path" is null or "document_lifecycle"."delete_path" in ('DUPLICATE', 'REQUEST')),
	CONSTRAINT "document_lifecycle_deleted_together" CHECK (("document_lifecycle"."deleted_at" is null) = ("document_lifecycle"."delete_path" is null) and ("document_lifecycle"."deleted_at" is null) = ("document_lifecycle"."purge_after" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_removal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"document_id" uuid,
	"document_code" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"requested_by_account_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_code" text,
	"completed_at" timestamp with time zone,
	"receipt_id" uuid,
	CONSTRAINT "document_removal_requests_code_shape" CHECK ("document_removal_requests"."document_code" ~ '^D-[0-9A-HJKMNP-TV-Z]{6,8}$'),
	CONSTRAINT "document_removal_requests_reason_known" CHECK ("document_removal_requests"."reason" in ('WRONG_PERSON', 'UPLOADED_BY_MISTAKE', 'NO_LONGER_NEEDED', 'PRIVACY_CONCERN', 'OTHER')),
	CONSTRAINT "document_removal_requests_status_known" CHECK ("document_removal_requests"."status" in ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'COMPLETED')),
	CONSTRAINT "document_removal_requests_decision_known" CHECK ("document_removal_requests"."decision_code" is null or "document_removal_requests"."decision_code" in ('APPROVED', 'LEGAL_HOLD', 'FINISHED_CASE_RECORD', 'AGENCY_REQUEST_ANSWER', 'RETENTION_REQUIRED', 'OTHER'))
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "applicant_lifecycle" ADD CONSTRAINT "applicant_lifecycle_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "applicant_lifecycle" ADD CONSTRAINT "applicant_lifecycle_archived_by_account_id_accounts_id_fk" FOREIGN KEY ("archived_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "applicant_lifecycle" ADD CONSTRAINT "applicant_lifecycle_deleted_by_account_id_accounts_id_fk" FOREIGN KEY ("deleted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "applicant_lifecycle" ADD CONSTRAINT "applicant_lifecycle_receipt_id_deletion_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."deletion_receipts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "deletion_receipts" ADD CONSTRAINT "deletion_receipts_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "deletion_receipts" ADD CONSTRAINT "deletion_receipts_requested_by_account_id_accounts_id_fk" FOREIGN KEY ("requested_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "deletion_receipts" ADD CONSTRAINT "deletion_receipts_approved_by_account_id_accounts_id_fk" FOREIGN KEY ("approved_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_lifecycle" ADD CONSTRAINT "document_lifecycle_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_lifecycle" ADD CONSTRAINT "document_lifecycle_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_lifecycle" ADD CONSTRAINT "document_lifecycle_archived_by_account_id_accounts_id_fk" FOREIGN KEY ("archived_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_lifecycle" ADD CONSTRAINT "document_lifecycle_deleted_by_account_id_accounts_id_fk" FOREIGN KEY ("deleted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_lifecycle" ADD CONSTRAINT "document_lifecycle_receipt_id_deletion_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."deletion_receipts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_removal_requests" ADD CONSTRAINT "document_removal_requests_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_removal_requests" ADD CONSTRAINT "document_removal_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_removal_requests" ADD CONSTRAINT "document_removal_requests_requested_by_account_id_accounts_id_fk" FOREIGN KEY ("requested_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_removal_requests" ADD CONSTRAINT "document_removal_requests_decided_by_account_id_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "document_removal_requests" ADD CONSTRAINT "document_removal_requests_receipt_id_deletion_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."deletion_receipts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applicant_lifecycle_purge_after_idx" ON "applicant_lifecycle" USING btree ("purge_after") WHERE "applicant_lifecycle"."deleted_at" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applicant_lifecycle_archived_by_idx" ON "applicant_lifecycle" USING btree ("archived_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applicant_lifecycle_deleted_by_idx" ON "applicant_lifecycle" USING btree ("deleted_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applicant_lifecycle_receipt_idx" ON "applicant_lifecycle" USING btree ("receipt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deletion_receipts_applicant_idx" ON "deletion_receipts" USING btree ("applicant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deletion_receipts_requested_by_idx" ON "deletion_receipts" USING btree ("requested_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deletion_receipts_approved_by_idx" ON "deletion_receipts" USING btree ("approved_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_lifecycle_applicant_idx" ON "document_lifecycle" USING btree ("applicant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_lifecycle_purge_after_idx" ON "document_lifecycle" USING btree ("purge_after") WHERE "document_lifecycle"."deleted_at" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_lifecycle_archived_by_idx" ON "document_lifecycle" USING btree ("archived_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_lifecycle_deleted_by_idx" ON "document_lifecycle" USING btree ("deleted_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_lifecycle_receipt_idx" ON "document_lifecycle" USING btree ("receipt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_removal_requests_applicant_idx" ON "document_removal_requests" USING btree ("applicant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_removal_requests_status_idx" ON "document_removal_requests" USING btree ("status","requested_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_removal_requests_requested_by_idx" ON "document_removal_requests" USING btree ("requested_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_removal_requests_decided_by_idx" ON "document_removal_requests" USING btree ("decided_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_removal_requests_receipt_idx" ON "document_removal_requests" USING btree ("receipt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_removal_requests_one_pending" ON "document_removal_requests" USING btree ("document_id") WHERE "document_removal_requests"."status" = 'PENDING';
--> statement-breakpoint
-- The Removal Record is kept as written. Only a forward status move, the approver, the time the
-- file was verified gone and new effects (existing effects never change or disappear) may be
-- recorded later; a record goes only when the person's whole record does (cascade), or when an
-- account it names is deleted (that name is cleared, nothing else).
CREATE OR REPLACE FUNCTION "visastack_deletion_receipts_guard"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF pg_trigger_depth() > 1 THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION 'deletion_receipts: a removal record cannot be deleted' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."applicant_id" IS DISTINCT FROM OLD."applicant_id"
		OR NEW."subject_kind" IS DISTINCT FROM OLD."subject_kind"
		OR NEW."subject_code" IS DISTINCT FROM OLD."subject_code"
		OR NEW."document_kind" IS DISTINCT FROM OLD."document_kind"
		OR NEW."uploaded_at" IS DISTINCT FROM OLD."uploaded_at"
		OR NEW."uploaded_by_role" IS DISTINCT FROM OLD."uploaded_by_role"
		OR NEW."path" IS DISTINCT FROM OLD."path"
		OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
		OR NEW."scheduled_for" IS DISTINCT FROM OLD."scheduled_for"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'deletion_receipts: a removal record cannot be edited' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW."requested_by_account_id" IS DISTINCT FROM OLD."requested_by_account_id"
		AND NOT (NEW."requested_by_account_id" IS NULL AND pg_trigger_depth() > 1) THEN
		RAISE EXCEPTION 'deletion_receipts: who asked cannot be changed' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD."verified_gone_at" IS NOT NULL AND NEW."verified_gone_at" IS DISTINCT FROM OLD."verified_gone_at" THEN
		RAISE EXCEPTION 'deletion_receipts: the verified time cannot be replaced' USING ERRCODE = 'restrict_violation';
	END IF;
	IF jsonb_typeof(NEW."effects") IS DISTINCT FROM 'object' OR NOT (NEW."effects" @> OLD."effects") THEN
		RAISE EXCEPTION 'deletion_receipts: effects can only be added' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
		(OLD."status" = 'SCHEDULED' AND NEW."status" IN ('RESTORED', 'REMOVING', 'BLOCKED'))
		OR (OLD."status" = 'REMOVING' AND NEW."status" IN ('REMOVED', 'BLOCKED'))
		OR (OLD."status" = 'BLOCKED' AND NEW."status" = 'REMOVING')
	) THEN
		RAISE EXCEPTION 'deletion_receipts: status % cannot move to %', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "deletion_receipts_guard" ON "deletion_receipts";
--> statement-breakpoint
CREATE TRIGGER "deletion_receipts_guard" BEFORE UPDATE OR DELETE ON "deletion_receipts" FOR EACH ROW EXECUTE FUNCTION "visastack_deletion_receipts_guard"();
