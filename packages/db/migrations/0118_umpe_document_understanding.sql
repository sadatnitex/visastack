-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Document understanding (UMPE P3): two new tables, nothing existing is touched.
-- document_upload_receipts keeps one row per upload id an account sent (ledger I16), so a repeat
-- of the same upload is answered with the document it already produced, never a second copy; it
-- also keeps the file's own name privately (never in audit records, never shown to an agency).
-- document_relation_proposals holds one suggested relation per new document version (exact
-- duplicate, corrected scan, new period, renewed), waiting for the traveller (ledger I13).
-- Until this runs the code finds the tables missing and uploads behave exactly as before.
CREATE TABLE IF NOT EXISTS "document_relation_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"related_document_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"new_is_current" boolean DEFAULT true NOT NULL,
	"signals" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_relation_proposals_version" UNIQUE("document_version_id"),
	CONSTRAINT "document_relation_proposals_relation_known" CHECK ("document_relation_proposals"."relation" in ('EXACT_DUPLICATE', 'CORRECTED_SCAN', 'NEW_PERIOD', 'RENEWED')),
	CONSTRAINT "document_relation_proposals_status_known" CHECK ("document_relation_proposals"."status" in ('PENDING', 'CONFIRMED', 'DISMISSED')),
	CONSTRAINT "document_relation_proposals_not_self" CHECK ("document_relation_proposals"."document_id" <> "document_relation_proposals"."related_document_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_upload_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"claim_token" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"upload_intent_id" uuid,
	"document_id" uuid,
	"document_version_id" uuid,
	"original_file_name" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_upload_receipts_account_upload" UNIQUE("account_id","upload_id"),
	CONSTRAINT "document_upload_receipts_status_known" CHECK ("document_upload_receipts"."status" in ('PENDING', 'COMPLETED')),
	CONSTRAINT "document_upload_receipts_name_cap" CHECK ("document_upload_receipts"."original_file_name" is null or char_length("document_upload_receipts"."original_file_name") <= 180)
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_relation_proposals_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "document_relation_proposals" ADD CONSTRAINT "document_relation_proposals_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_relation_proposals_document_id_documents_id_fk') THEN
		ALTER TABLE "document_relation_proposals" ADD CONSTRAINT "document_relation_proposals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_relation_proposals_document_version_id_document_versions_id_fk') THEN
		ALTER TABLE "document_relation_proposals" ADD CONSTRAINT "document_relation_proposals_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_relation_proposals_related_document_id_documents_id_fk') THEN
		ALTER TABLE "document_relation_proposals" ADD CONSTRAINT "document_relation_proposals_related_document_id_documents_id_fk" FOREIGN KEY ("related_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_relation_proposals_decided_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "document_relation_proposals" ADD CONSTRAINT "document_relation_proposals_decided_by_account_id_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_upload_receipts_account_id_accounts_id_fk') THEN
		ALTER TABLE "document_upload_receipts" ADD CONSTRAINT "document_upload_receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_upload_receipts_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "document_upload_receipts" ADD CONSTRAINT "document_upload_receipts_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_upload_receipts_upload_intent_id_upload_intents_id_fk') THEN
		ALTER TABLE "document_upload_receipts" ADD CONSTRAINT "document_upload_receipts_upload_intent_id_upload_intents_id_fk" FOREIGN KEY ("upload_intent_id") REFERENCES "public"."upload_intents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_upload_receipts_document_id_documents_id_fk') THEN
		ALTER TABLE "document_upload_receipts" ADD CONSTRAINT "document_upload_receipts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_upload_receipts_document_version_id_document_versions_id_fk') THEN
		ALTER TABLE "document_upload_receipts" ADD CONSTRAINT "document_upload_receipts_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_relation_proposals_applicant_status_idx" ON "document_relation_proposals" USING btree ("applicant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_relation_proposals_document_idx" ON "document_relation_proposals" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_relation_proposals_related_idx" ON "document_relation_proposals" USING btree ("related_document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_upload_receipts_version_idx" ON "document_upload_receipts" USING btree ("document_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_upload_receipts_applicant_idx" ON "document_upload_receipts" USING btree ("applicant_id");
