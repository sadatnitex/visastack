ALTER TABLE "mission_snapshots" ADD COLUMN "material_revision_at_capture" integer;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "material_revision" integer DEFAULT 1 NOT NULL;