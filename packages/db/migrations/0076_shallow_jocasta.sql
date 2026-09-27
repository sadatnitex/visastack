CREATE TYPE "public"."ai_provider_config_status" AS ENUM('DRAFT', 'ACTIVE', 'SUPERSEDED', 'DISABLED');--> statement-breakpoint
CREATE TABLE "ai_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "ai_provider_config_status" DEFAULT 'DRAFT' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"reasoning_effort" text,
	"api_key_ciphertext" "bytea" NOT NULL,
	"api_key_nonce" "bytea" NOT NULL,
	"api_key_version" text NOT NULL,
	"api_key_fingerprint" text NOT NULL,
	"key_revoked_at" timestamp with time zone,
	"data_policy_approved" boolean DEFAULT false NOT NULL,
	"budget_limit_units" integer NOT NULL,
	"per_document_budget_limit_units" integer,
	"max_attempts_per_document" integer,
	"max_pages_per_document" integer,
	"cache_max_age_days" integer,
	"max_concurrent_calls" integer,
	"notes" text,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_provider_configs_status_idx" ON "ai_provider_configs" USING btree ("status");