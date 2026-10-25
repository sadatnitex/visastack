CREATE TABLE "ai_data_rule_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"require_no_training" boolean NOT NULL,
	"reason" text,
	"changed_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_data_rule_settings_reason_length" CHECK ("ai_data_rule_settings"."reason" is null or char_length("ai_data_rule_settings"."reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ai_provider_config_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"trains_on_inputs" text NOT NULL,
	"retention_days" integer,
	"region" text,
	"terms_url" text,
	"checked_on" date NOT NULL,
	"notes" text,
	"recorded_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_config_terms_tier_valid" CHECK ("ai_provider_config_terms"."tier" in ('FREE', 'PAID')),
	CONSTRAINT "ai_provider_config_terms_training_valid" CHECK ("ai_provider_config_terms"."trains_on_inputs" in ('YES', 'NO', 'UNKNOWN')),
	CONSTRAINT "ai_provider_config_terms_retention_range" CHECK ("ai_provider_config_terms"."retention_days" is null or "ai_provider_config_terms"."retention_days" between 0 and 3650),
	CONSTRAINT "ai_provider_config_terms_region_length" CHECK ("ai_provider_config_terms"."region" is null or char_length("ai_provider_config_terms"."region") <= 120),
	CONSTRAINT "ai_provider_config_terms_url_valid" CHECK ("ai_provider_config_terms"."terms_url" is null or ("ai_provider_config_terms"."terms_url" like 'https://%' and char_length("ai_provider_config_terms"."terms_url") <= 500)),
	CONSTRAINT "ai_provider_config_terms_notes_length" CHECK ("ai_provider_config_terms"."notes" is null or char_length("ai_provider_config_terms"."notes") <= 500),
	CONSTRAINT "ai_provider_config_terms_no_needs_source" CHECK ("ai_provider_config_terms"."trains_on_inputs" <> 'NO' or "ai_provider_config_terms"."terms_url" is not null)
);
--> statement-breakpoint
ALTER TABLE "ai_data_rule_settings" ADD CONSTRAINT "ai_data_rule_settings_changed_by_account_id_accounts_id_fk" FOREIGN KEY ("changed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_config_terms" ADD CONSTRAINT "ai_provider_config_terms_config_id_ai_provider_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_provider_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_config_terms" ADD CONSTRAINT "ai_provider_config_terms_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_data_rule_settings_created_idx" ON "ai_data_rule_settings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_provider_config_terms_config_idx" ON "ai_provider_config_terms" USING btree ("config_id","created_at");