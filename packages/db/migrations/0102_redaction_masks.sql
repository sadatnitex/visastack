-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Safe copies (ADR 0022, S23): the black boxes a record owner places on each page of one
-- document version, and each page drawn once with its boxes painted black and kept as a private
-- derived file. Additive: one new table and one new erasure reason, nothing existing is touched.
-- Until this runs, every document's safe copy reads "Not Prepared Yet", nothing is served, and
-- saving says safe copies are not ready yet.
-- A database that ran an earlier draft of this file (the table without mask revisions or stored
-- drawings) is brought to this shape by the statements after CREATE TABLE: every later column is
-- added if missing, boxes saved under the draft get one revision per version (so they read as
-- still preparing, and are drawn again before anything is served), and every later constraint,
-- link and index is added only when it is not there yet.
ALTER TYPE "public"."erasure_job_reason" ADD VALUE IF NOT EXISTS 'SAFE_COPY_REMOVAL';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "redaction_masks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"boxes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"created_by_account_id" uuid NOT NULL,
	"mask_revision" uuid NOT NULL,
	"rendered_storage_object_id" uuid,
	"rendered_content_type" text,
	"rendered_byte_size" integer,
	"rendered_width_pt" double precision,
	"rendered_height_pt" double precision,
	"rendered_at" timestamp with time zone,
	"pending_storage_object_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redaction_masks_version_page_unique" UNIQUE("document_version_id","page"),
	CONSTRAINT "redaction_masks_rendered_together" CHECK ("redaction_masks"."rendered_storage_object_id" is null or ("redaction_masks"."rendered_content_type" in ('image/jpeg', 'image/png') and "redaction_masks"."rendered_byte_size" > 0 and "redaction_masks"."rendered_width_pt" > 0 and "redaction_masks"."rendered_height_pt" > 0 and "redaction_masks"."rendered_at" is not null)),
	CONSTRAINT "redaction_masks_page_range" CHECK ("redaction_masks"."page" between 1 and 20),
	CONSTRAINT "redaction_masks_source_known" CHECK ("redaction_masks"."source" in ('OWNER', 'SUGGESTED_ACCEPTED')),
	CONSTRAINT "redaction_masks_boxes_shape" CHECK (case when jsonb_typeof("redaction_masks"."boxes") = 'array' then jsonb_array_length("redaction_masks"."boxes") <= 200 else false end)
);
--> statement-breakpoint
ALTER TABLE "redaction_masks" ADD COLUMN IF NOT EXISTS "mask_revision" uuid;
--> statement-breakpoint
ALTER TABLE "redaction_masks" ADD COLUMN IF NOT EXISTS "rendered_storage_object_id" uuid;
--> statement-breakpoint
ALTER TABLE "redaction_masks" ADD COLUMN IF NOT EXISTS "rendered_content_type" text;
--> statement-breakpoint
ALTER TABLE "redaction_masks" ADD COLUMN IF NOT EXISTS "rendered_byte_size" integer;
--> statement-breakpoint
ALTER TABLE "redaction_masks" ADD COLUMN IF NOT EXISTS "rendered_width_pt" double precision;
--> statement-breakpoint
ALTER TABLE "redaction_masks" ADD COLUMN IF NOT EXISTS "rendered_height_pt" double precision;
--> statement-breakpoint
ALTER TABLE "redaction_masks" ADD COLUMN IF NOT EXISTS "rendered_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "redaction_masks" ADD COLUMN IF NOT EXISTS "pending_storage_object_id" uuid;
--> statement-breakpoint
UPDATE "redaction_masks" SET "mask_revision" = md5("document_version_id"::text)::uuid WHERE "mask_revision" IS NULL;
--> statement-breakpoint
ALTER TABLE "redaction_masks" ALTER COLUMN "mask_revision" SET NOT NULL;
--> statement-breakpoint
DO $ck$ BEGIN
	ALTER TABLE "redaction_masks" ADD CONSTRAINT "redaction_masks_rendered_together" CHECK ("redaction_masks"."rendered_storage_object_id" is null or ("redaction_masks"."rendered_content_type" in ('image/jpeg', 'image/png') and "redaction_masks"."rendered_byte_size" > 0 and "redaction_masks"."rendered_width_pt" > 0 and "redaction_masks"."rendered_height_pt" > 0 and "redaction_masks"."rendered_at" is not null));
EXCEPTION WHEN duplicate_object THEN NULL;
END $ck$;
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
DO $fk$ BEGIN
	ALTER TABLE "redaction_masks" ADD CONSTRAINT "redaction_masks_rendered_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("rendered_storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "redaction_masks" ADD CONSTRAINT "redaction_masks_pending_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("pending_storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redaction_masks_created_by_idx" ON "redaction_masks" USING btree ("created_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redaction_masks_rendered_object_idx" ON "redaction_masks" USING btree ("rendered_storage_object_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redaction_masks_pending_object_idx" ON "redaction_masks" USING btree ("pending_storage_object_id");
