CREATE TYPE "public"."mission_note_visibility" AS ENUM('AGENCY_INTERNAL', 'TRAVELLER_SHARED');--> statement-breakpoint
ALTER TABLE "mission_notes" ADD COLUMN "author_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "mission_notes" ADD COLUMN "visibility" "mission_note_visibility" DEFAULT 'AGENCY_INTERNAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_notes" ADD CONSTRAINT "mission_notes_author_organization_id_organizations_id_fk" FOREIGN KEY ("author_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;