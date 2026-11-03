-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Automatic placement (UMPE G4): one new table, nothing existing is touched.
-- document_auto_placements keeps, for each file whose kind was applied from a confident AI
-- recognition or that was filed automatically under the one person it matched exactly, what it
-- was before, so the owner can Change it back in one step. Kinds and names only.
-- Until this runs the code finds the table missing and nothing is placed automatically.
CREATE TABLE IF NOT EXISTS "document_auto_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"placement" text NOT NULL,
	"status" text DEFAULT 'APPLIED' NOT NULL,
	"previous_doc_type" text,
	"previous_name" text,
	"applied_doc_type" text,
	"applied_name" text,
	"confidence" integer,
	"type_proposal_id" uuid,
	"classification_id" uuid,
	"hold_id" uuid,
	"changed_by_account_id" uuid,
	"changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_auto_placements_document_placement" UNIQUE("document_id","placement"),
	CONSTRAINT "document_auto_placements_placement_known" CHECK ("document_auto_placements"."placement" in ('KIND', 'PERSON')),
	CONSTRAINT "document_auto_placements_status_known" CHECK ("document_auto_placements"."status" in ('APPLIED', 'CHANGED'))
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_auto_placements_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "document_auto_placements" ADD CONSTRAINT "document_auto_placements_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_auto_placements_document_id_documents_id_fk') THEN
		ALTER TABLE "document_auto_placements" ADD CONSTRAINT "document_auto_placements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_auto_placements_type_proposal_id_document_type_proposals_id_fk') THEN
		ALTER TABLE "document_auto_placements" ADD CONSTRAINT "document_auto_placements_type_proposal_id_document_type_proposals_id_fk" FOREIGN KEY ("type_proposal_id") REFERENCES "public"."document_type_proposals"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_auto_placements_classification_id_document_classifications_id_fk') THEN
		ALTER TABLE "document_auto_placements" ADD CONSTRAINT "document_auto_placements_classification_id_document_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."document_classifications"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_auto_placements_hold_id_document_person_holds_id_fk') THEN
		ALTER TABLE "document_auto_placements" ADD CONSTRAINT "document_auto_placements_hold_id_document_person_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."document_person_holds"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_auto_placements_changed_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "document_auto_placements" ADD CONSTRAINT "document_auto_placements_changed_by_account_id_accounts_id_fk" FOREIGN KEY ("changed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_auto_placements_applicant_status_idx" ON "document_auto_placements" USING btree ("applicant_id","status");
