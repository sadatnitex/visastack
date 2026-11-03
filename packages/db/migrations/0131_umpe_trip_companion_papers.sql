-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Travelling with someone else (UMPE UX6, package 4): one new table, nothing existing is touched.
-- umpe_trip_companion_papers holds the papers a joined companion chose to show the organiser BY
-- NAME ONLY (the paper's display name and kind, never the file or its details) while their sharing
-- level is Travel Bookings. A row is only a choice: it holds no copy of the paper, and deleting the
-- paper or the companion removes it. Until this runs the code finds the table missing, the Travel
-- Bookings level shows the organiser nothing extra, and the choice list is empty.
CREATE TABLE IF NOT EXISTS "umpe_trip_companion_papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "umpe_trip_companion_papers_pair_unique" UNIQUE("companion_id","document_id")
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_companion_papers_companion_fk') THEN
		ALTER TABLE "umpe_trip_companion_papers" ADD CONSTRAINT "umpe_trip_companion_papers_companion_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."umpe_trip_companions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_companion_papers_document_id_documents_id_fk') THEN
		ALTER TABLE "umpe_trip_companion_papers" ADD CONSTRAINT "umpe_trip_companion_papers_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_companion_papers_companion_idx" ON "umpe_trip_companion_papers" USING btree ("companion_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_companion_papers_document_idx" ON "umpe_trip_companion_papers" USING btree ("document_id");
