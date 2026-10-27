-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- AI connections (Small Commercial V1 S13, ADR 0021). Additive: two types and three new tables,
-- nothing existing is touched. Until this runs, connecting an AI app reports "not available yet".
DO $enum$ BEGIN
	CREATE TYPE "public"."ai_connection_case_mode" AS ENUM('NONE', 'ONE', 'ALL_CURRENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;
--> statement-breakpoint
DO $enum$ BEGIN
	CREATE TYPE "public"."ai_token_kind" AS ENUM('CODE', 'ACCESS', 'REFRESH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_connection_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" "ai_token_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"code_challenge" text,
	"redirect_uri" text,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_connection_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "ai_connection_tokens_code_binding" CHECK ("ai_connection_tokens"."kind" <> 'CODE' or ("ai_connection_tokens"."code_challenge" is not null and "ai_connection_tokens"."redirect_uri" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"client_host" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"case_mode" "ai_connection_case_mode" NOT NULL,
	"mission_id" uuid,
	"reveal_identifiers" boolean DEFAULT false NOT NULL,
	"depth" text DEFAULT 'standard' NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "ai_connections_case_mode_mission" CHECK ("ai_connections"."case_mode" = 'ONE' or "ai_connections"."mission_id" is null),
	CONSTRAINT "ai_connections_depth" CHECK ("ai_connections"."depth" in ('brief', 'standard', 'full'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "ai_connection_tokens" ADD CONSTRAINT "ai_connection_tokens_connection_id_ai_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_connection_tokens_connection_idx" ON "ai_connection_tokens" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_connection_tokens_family_idx" ON "ai_connection_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_connections_account_idx" ON "ai_connections" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_connections_applicant_idx" ON "ai_connections" USING btree ("applicant_id");