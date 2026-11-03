-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Intake gap closure (UMPE G1): two new tables, nothing existing is touched.
-- document_intake_exceptions holds what a file showed when it was read (no readable text, expired
-- on the day it was added), once per version and kind, until the traveller answers (ledger I14).
-- document_person_holds holds files of a family batch that belong to nobody yet, owned by the
-- uploading account only, until its Which Person? decision files them through the access check
-- for the chosen person (ledger I09). Facts read from a file are never stored.
-- Until this runs the code finds the tables missing and uploads behave exactly as before.
CREATE TABLE IF NOT EXISTS "document_intake_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_intake_exceptions_version_kind" UNIQUE("document_version_id","kind"),
	CONSTRAINT "document_intake_exceptions_kind_known" CHECK ("document_intake_exceptions"."kind" in ('EXPIRED_ON_ARRIVAL', 'NO_READABLE_TEXT')),
	CONSTRAINT "document_intake_exceptions_status_known" CHECK ("document_intake_exceptions"."status" in ('PENDING', 'DISMISSED'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_person_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" uuid,
	"upload_id" uuid NOT NULL,
	"claim_token" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"original_file_name" text,
	"virus_scanned" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'RECEIVING' NOT NULL,
	"proposed_applicant_id" uuid,
	"proposal_basis" text,
	"filed_document_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_person_holds_account_upload" UNIQUE("owner_account_id","upload_id"),
	CONSTRAINT "document_person_holds_object_key" UNIQUE("object_key"),
	CONSTRAINT "document_person_holds_status_known" CHECK ("document_person_holds"."status" in ('RECEIVING', 'HELD', 'FILING', 'FILED', 'DISCARDED')),
	CONSTRAINT "document_person_holds_basis_known" CHECK ("document_person_holds"."proposal_basis" is null or "document_person_holds"."proposal_basis" in ('NAME_AND_BIRTH_DATE', 'CLOSE_MATCHES', 'NO_MATCH', 'NOT_READ')),
	CONSTRAINT "document_person_holds_name_cap" CHECK ("document_person_holds"."original_file_name" is null or char_length("document_person_holds"."original_file_name") <= 180),
	CONSTRAINT "document_person_holds_size_positive" CHECK ("document_person_holds"."size_bytes" > 0)
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_intake_exceptions_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "document_intake_exceptions" ADD CONSTRAINT "document_intake_exceptions_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_intake_exceptions_document_id_documents_id_fk') THEN
		ALTER TABLE "document_intake_exceptions" ADD CONSTRAINT "document_intake_exceptions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_intake_exceptions_document_version_id_document_versions_id_fk') THEN
		ALTER TABLE "document_intake_exceptions" ADD CONSTRAINT "document_intake_exceptions_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_intake_exceptions_decided_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "document_intake_exceptions" ADD CONSTRAINT "document_intake_exceptions_decided_by_account_id_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_person_holds_owner_account_id_accounts_id_fk') THEN
		ALTER TABLE "document_person_holds" ADD CONSTRAINT "document_person_holds_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_person_holds_proposed_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "document_person_holds" ADD CONSTRAINT "document_person_holds_proposed_applicant_id_applicants_id_fk" FOREIGN KEY ("proposed_applicant_id") REFERENCES "public"."applicants"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_person_holds_filed_document_id_documents_id_fk') THEN
		ALTER TABLE "document_person_holds" ADD CONSTRAINT "document_person_holds_filed_document_id_documents_id_fk" FOREIGN KEY ("filed_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_intake_exceptions_applicant_status_idx" ON "document_intake_exceptions" USING btree ("applicant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_person_holds_owner_status_idx" ON "document_person_holds" USING btree ("owner_account_id","status");
