-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Official-source monitoring (UMPE P10): four new tables for the Saturday source check. Additive:
-- nothing existing is touched, and no pack, pack version or pack requirement is ever written by
-- this feature. official_sources is the register of official pages per route; source_check_runs
-- holds one row per run with counts only; source_observations records what each fetch found
-- (outcome, fingerprints, a short excerpt); source_change_candidates holds machine-detected
-- changes waiting for a person. Until this runs the code finds the tables missing and does nothing.
CREATE TABLE IF NOT EXISTS "official_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction" text NOT NULL,
	"route" text,
	"purpose" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text NOT NULL,
	"authority_tier" text NOT NULL,
	"pack_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "official_sources_jurisdiction_shape" CHECK ("official_sources"."jurisdiction" ~ '^[A-Z]{2}$'),
	CONSTRAINT "official_sources_url_https" CHECK ("official_sources"."url" like 'https://%' and char_length("official_sources"."url") <= 2048),
	CONSTRAINT "official_sources_authority_tier_known" CHECK ("official_sources"."authority_tier" in ('GOVERNMENT', 'CONSULATE', 'OFFICIAL_APPLICATION', 'AUTHORIZED_VAC')),
	CONSTRAINT "official_sources_active_matches_deactivated" CHECK ("official_sources"."active" = ("official_sources"."deactivated_at" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_key" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"sources_due" integer DEFAULT 0 NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"unsupported" integer DEFAULT 0 NOT NULL,
	"deferred" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "source_check_runs_run_key_unique" UNIQUE("run_key"),
	CONSTRAINT "source_check_runs_trigger_known" CHECK ("source_check_runs"."trigger" in ('SCHEDULED', 'MANUAL')),
	CONSTRAINT "source_check_runs_counts_non_negative" CHECK ("source_check_runs"."sources_due" >= 0 and "source_check_runs"."checked" >= 0 and "source_check_runs"."changed" >= 0 and "source_check_runs"."blocked" >= 0 and "source_check_runs"."failed" >= 0 and "source_check_runs"."unsupported" >= 0 and "source_check_runs"."deferred" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"http_status" integer,
	"outcome" text NOT NULL,
	"etag" text,
	"last_modified" text,
	"content_sha256" text,
	"normalized_sha256" text,
	"byte_length" integer,
	"excerpt" text,
	CONSTRAINT "source_observations_source_run" UNIQUE("source_id","run_id"),
	CONSTRAINT "source_observations_outcome_known" CHECK ("source_observations"."outcome" in ('FETCHED', 'NOT_MODIFIED', 'BLOCKED', 'TIMEOUT', 'REDIRECT_REFUSED', 'TOO_LARGE', 'UNSUPPORTED_FORMAT', 'ERROR')),
	CONSTRAINT "source_observations_excerpt_cap" CHECK ("source_observations"."excerpt" is null or char_length("source_observations"."excerpt") <= 2000),
	CONSTRAINT "source_observations_fetched_has_hash" CHECK ("source_observations"."outcome" <> 'FETCHED' or "source_observations"."normalized_sha256" is not null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_change_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"previous_observation_id" uuid,
	"normalized_sha256" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"old_excerpt" text,
	"new_excerpt" text,
	"reviewer_account_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_change_candidates_source_hash" UNIQUE("source_id","normalized_sha256"),
	CONSTRAINT "source_change_candidates_status_known" CHECK ("source_change_candidates"."status" in ('NEW', 'IN_REVIEW', 'DISMISSED', 'ACCEPTED_FOR_DRAFT')),
	CONSTRAINT "source_change_candidates_excerpt_cap" CHECK (("source_change_candidates"."old_excerpt" is null or char_length("source_change_candidates"."old_excerpt") <= 2000) and ("source_change_candidates"."new_excerpt" is null or char_length("source_change_candidates"."new_excerpt") <= 2000)),
	CONSTRAINT "source_change_candidates_note_cap" CHECK ("source_change_candidates"."review_note" is null or char_length("source_change_candidates"."review_note") <= 1000)
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'official_sources_pack_id_packs_id_fk') THEN
		ALTER TABLE "official_sources" ADD CONSTRAINT "official_sources_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'official_sources_created_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "official_sources" ADD CONSTRAINT "official_sources_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_observations_source_id_official_sources_id_fk') THEN
		ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_source_id_official_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."official_sources"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_observations_run_id_source_check_runs_id_fk') THEN
		ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_run_id_source_check_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."source_check_runs"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_change_candidates_source_id_official_sources_id_fk') THEN
		ALTER TABLE "source_change_candidates" ADD CONSTRAINT "source_change_candidates_source_id_official_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."official_sources"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_change_candidates_observation_id_source_observations_id_fk') THEN
		ALTER TABLE "source_change_candidates" ADD CONSTRAINT "source_change_candidates_observation_id_source_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."source_observations"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_change_candidates_previous_observation_id_source_observations_id_fk') THEN
		ALTER TABLE "source_change_candidates" ADD CONSTRAINT "source_change_candidates_previous_observation_id_source_observations_id_fk" FOREIGN KEY ("previous_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_change_candidates_reviewer_account_id_accounts_id_fk') THEN
		ALTER TABLE "source_change_candidates" ADD CONSTRAINT "source_change_candidates_reviewer_account_id_accounts_id_fk" FOREIGN KEY ("reviewer_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "official_sources_active_url" ON "official_sources" USING btree ("url") WHERE "official_sources"."active";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "official_sources_pack_idx" ON "official_sources" USING btree ("pack_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "official_sources_created_by_idx" ON "official_sources" USING btree ("created_by_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_observations_source_fetched_idx" ON "source_observations" USING btree ("source_id","fetched_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_observations_run_idx" ON "source_observations" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_change_candidates_status_idx" ON "source_change_candidates" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_change_candidates_observation_idx" ON "source_change_candidates" USING btree ("observation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_change_candidates_previous_idx" ON "source_change_candidates" USING btree ("previous_observation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_change_candidates_reviewer_idx" ON "source_change_candidates" USING btree ("reviewer_account_id");
