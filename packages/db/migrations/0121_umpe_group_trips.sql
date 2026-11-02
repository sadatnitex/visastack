-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Group trips and family packages (UMPE P5): four new tables, nothing existing is touched.
-- umpe_trips holds one account's shared travel intention (destination, purpose, a trip label).
-- umpe_trip_travellers links each traveller's own ordinary case to the trip; removing a traveller
-- only sets removed_at, their case is never touched.
-- umpe_trip_evidence references one traveller's own travel document (a booking or itinerary) as
-- common trip evidence, never a copy; umpe_trip_evidence_allowances records each explicit
-- allowance for another traveller. Nothing is shared between travellers by default.
-- Until this runs the code finds the tables missing and cases behave exactly as before.
CREATE TABLE IF NOT EXISTS "umpe_trip_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"source_applicant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"added_by_account_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "umpe_trip_evidence_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_evidence_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"allowed_by_account_id" uuid,
	"allowed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "umpe_trip_travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"added_by_account_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "umpe_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"title" text NOT NULL,
	"destination" text NOT NULL,
	"purpose" text NOT NULL,
	"itinerary_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "umpe_trips_title_cap" CHECK (char_length("umpe_trips"."title") between 1 and 200),
	CONSTRAINT "umpe_trips_destination_cap" CHECK (char_length("umpe_trips"."destination") between 1 and 120),
	CONSTRAINT "umpe_trips_purpose_cap" CHECK (char_length("umpe_trips"."purpose") between 1 and 120),
	CONSTRAINT "umpe_trips_itinerary_cap" CHECK (char_length("umpe_trips"."itinerary_ref") between 1 and 200)
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_evidence_trip_id_umpe_trips_id_fk') THEN
		ALTER TABLE "umpe_trip_evidence" ADD CONSTRAINT "umpe_trip_evidence_trip_id_umpe_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."umpe_trips"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_evidence_source_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "umpe_trip_evidence" ADD CONSTRAINT "umpe_trip_evidence_source_applicant_id_applicants_id_fk" FOREIGN KEY ("source_applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_evidence_document_id_documents_id_fk') THEN
		ALTER TABLE "umpe_trip_evidence" ADD CONSTRAINT "umpe_trip_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_evidence_added_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_trip_evidence" ADD CONSTRAINT "umpe_trip_evidence_added_by_account_id_accounts_id_fk" FOREIGN KEY ("added_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_evidence_allowances_trip_evidence_id_umpe_trip_eviden') THEN
		ALTER TABLE "umpe_trip_evidence_allowances" ADD CONSTRAINT "umpe_trip_evidence_allowances_trip_evidence_id_umpe_trip_evidence_id_fk" FOREIGN KEY ("trip_evidence_id") REFERENCES "public"."umpe_trip_evidence"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_evidence_allowances_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "umpe_trip_evidence_allowances" ADD CONSTRAINT "umpe_trip_evidence_allowances_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_evidence_allowances_allowed_by_account_id_accounts_id') THEN
		ALTER TABLE "umpe_trip_evidence_allowances" ADD CONSTRAINT "umpe_trip_evidence_allowances_allowed_by_account_id_accounts_id_fk" FOREIGN KEY ("allowed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_travellers_trip_id_umpe_trips_id_fk') THEN
		ALTER TABLE "umpe_trip_travellers" ADD CONSTRAINT "umpe_trip_travellers_trip_id_umpe_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."umpe_trips"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_travellers_applicant_id_applicants_id_fk') THEN
		ALTER TABLE "umpe_trip_travellers" ADD CONSTRAINT "umpe_trip_travellers_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_travellers_mission_id_missions_id_fk') THEN
		ALTER TABLE "umpe_trip_travellers" ADD CONSTRAINT "umpe_trip_travellers_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_travellers_added_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_trip_travellers" ADD CONSTRAINT "umpe_trip_travellers_added_by_account_id_accounts_id_fk" FOREIGN KEY ("added_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trips_owner_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_trips" ADD CONSTRAINT "umpe_trips_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "umpe_trip_evidence_live" ON "umpe_trip_evidence" USING btree ("trip_id","document_id") WHERE "umpe_trip_evidence"."removed_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_evidence_source_idx" ON "umpe_trip_evidence" USING btree ("source_applicant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_evidence_document_idx" ON "umpe_trip_evidence" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_evidence_added_by_idx" ON "umpe_trip_evidence" USING btree ("added_by_account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "umpe_trip_evidence_allowances_live" ON "umpe_trip_evidence_allowances" USING btree ("trip_evidence_id","applicant_id") WHERE "umpe_trip_evidence_allowances"."revoked_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_evidence_allowances_applicant_idx" ON "umpe_trip_evidence_allowances" USING btree ("applicant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_evidence_allowances_allowed_by_idx" ON "umpe_trip_evidence_allowances" USING btree ("allowed_by_account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "umpe_trip_travellers_live" ON "umpe_trip_travellers" USING btree ("trip_id","applicant_id") WHERE "umpe_trip_travellers"."removed_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_travellers_applicant_idx" ON "umpe_trip_travellers" USING btree ("applicant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_travellers_mission_idx" ON "umpe_trip_travellers" USING btree ("mission_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_travellers_added_by_idx" ON "umpe_trip_travellers" USING btree ("added_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trips_owner_idx" ON "umpe_trips" USING btree ("owner_account_id","created_at");
