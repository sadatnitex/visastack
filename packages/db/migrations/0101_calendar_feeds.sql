-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Private calendar subscription links (v1.2 B05 live feed, ADR 0016). Additive: one new table,
-- nothing existing is touched. Until this runs, the calendar page says subscribing is not
-- available yet and the feed address answers "not found".
CREATE TABLE IF NOT EXISTS "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"link_made_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_applicant_unique" UNIQUE("applicant_id"),
	CONSTRAINT "calendar_feeds_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "calendar_feeds_secret_hash_shape" CHECK ("calendar_feeds"."secret_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_feeds_owner_idx" ON "calendar_feeds" USING btree ("owner_account_id");
