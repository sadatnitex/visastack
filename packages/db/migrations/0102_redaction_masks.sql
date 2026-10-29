-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Safe copies (ADR 0022, S23): the black boxes a record owner places on each page of one
-- document version. Additive: one new table, nothing existing is touched. Until this runs, every
-- document's safe copy reads "Not Prepared Yet", nothing is served, and saving says safe copies
-- are not ready yet.
CREATE TABLE IF NOT EXISTS "redaction_masks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"boxes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"created_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redaction_masks_version_page_unique" UNIQUE("document_version_id","page"),
	CONSTRAINT "redaction_masks_page_range" CHECK ("redaction_masks"."page" between 1 and 20),
	CONSTRAINT "redaction_masks_source_known" CHECK ("redaction_masks"."source" in ('OWNER', 'SUGGESTED_ACCEPTED')),
	CONSTRAINT "redaction_masks_boxes_shape" CHECK (case when jsonb_typeof("redaction_masks"."boxes") = 'array' then jsonb_array_length("redaction_masks"."boxes") <= 200 else false end)
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "redaction_masks" ADD CONSTRAINT "redaction_masks_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "redaction_masks" ADD CONSTRAINT "redaction_masks_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redaction_masks_created_by_idx" ON "redaction_masks" USING btree ("created_by_account_id");
