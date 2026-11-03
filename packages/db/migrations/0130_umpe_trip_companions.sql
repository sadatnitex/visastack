-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Travelling with someone else (UMPE UX6, package 1): one new table, nothing existing is touched.
-- umpe_trip_companions holds a person the organiser added to a trip by name and an optional email.
-- There is no applicant, account or case behind a row until that person accepts, and even then a
-- companion never becomes a traveller on the trip. Only the hash of an invitation token is kept,
-- and only while the row is INVITED. share_level is what the companion lets the organiser see.
-- Until this runs the code finds the table missing and trips behave exactly as before.
CREATE TABLE IF NOT EXISTS "umpe_trip_companions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"state" text NOT NULL,
	"share_level" text DEFAULT 'NAME_ONLY' NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"joined_account_id" uuid,
	"invited_by_account_id" uuid NOT NULL,
	"own_mission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "umpe_trip_companions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "umpe_trip_companions_name_cap" CHECK (char_length("umpe_trip_companions"."display_name") between 1 and 120),
	CONSTRAINT "umpe_trip_companions_email_shape" CHECK ("umpe_trip_companions"."email" is null or (char_length("umpe_trip_companions"."email") between 3 and 254 and "umpe_trip_companions"."email" = lower("umpe_trip_companions"."email"))),
	CONSTRAINT "umpe_trip_companions_state_known" CHECK ("umpe_trip_companions"."state" in ('NAME_ONLY', 'INVITED', 'JOINED', 'DECLINED', 'REMOVED', 'LEFT')),
	CONSTRAINT "umpe_trip_companions_share_level_known" CHECK ("umpe_trip_companions"."share_level" in ('NAME_ONLY', 'PLAN_STATUS', 'TRAVEL_BOOKINGS')),
	CONSTRAINT "umpe_trip_companions_token_only_when_invited" CHECK (("umpe_trip_companions"."state" = 'INVITED' and "umpe_trip_companions"."token_hash" is not null and "umpe_trip_companions"."expires_at" is not null) or ("umpe_trip_companions"."state" <> 'INVITED' and "umpe_trip_companions"."token_hash" is null))
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_companions_trip_id_umpe_trips_id_fk') THEN
		ALTER TABLE "umpe_trip_companions" ADD CONSTRAINT "umpe_trip_companions_trip_id_umpe_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."umpe_trips"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_companions_joined_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_trip_companions" ADD CONSTRAINT "umpe_trip_companions_joined_account_id_accounts_id_fk" FOREIGN KEY ("joined_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_companions_invited_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "umpe_trip_companions" ADD CONSTRAINT "umpe_trip_companions_invited_by_account_id_accounts_id_fk" FOREIGN KEY ("invited_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'umpe_trip_companions_own_mission_id_missions_id_fk') THEN
		ALTER TABLE "umpe_trip_companions" ADD CONSTRAINT "umpe_trip_companions_own_mission_id_missions_id_fk" FOREIGN KEY ("own_mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_companions_trip_idx" ON "umpe_trip_companions" USING btree ("trip_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_companions_joined_account_idx" ON "umpe_trip_companions" USING btree ("joined_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_companions_invited_by_idx" ON "umpe_trip_companions" USING btree ("invited_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_companions_own_mission_idx" ON "umpe_trip_companions" USING btree ("own_mission_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "umpe_trip_companions_invited_email_idx" ON "umpe_trip_companions" USING btree ("email") WHERE "umpe_trip_companions"."state" = 'INVITED';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "umpe_trip_companions_joined_account_live" ON "umpe_trip_companions" USING btree ("trip_id","joined_account_id") WHERE "umpe_trip_companions"."state" = 'JOINED';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "umpe_trip_companions_live_email" ON "umpe_trip_companions" USING btree ("trip_id","email") WHERE "umpe_trip_companions"."state" in ('INVITED', 'JOINED') and "umpe_trip_companions"."email" is not null;
