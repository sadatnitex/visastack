CREATE TYPE "public"."fact_status" AS ENUM('DECLARED', 'EXTRACTED_PENDING', 'APPLICANT_CONFIRMED', 'DOCUMENT_SUPPORTED', 'AGENCY_REVIEWED', 'CONFLICTED', 'STALE', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."field_sensitivity" AS ENUM('STANDARD', 'SENSITIVE', 'RESTRICTED');--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fact_version_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"page" integer,
	"region" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_links_unique" UNIQUE("fact_version_id","document_version_id")
);
--> statement-breakpoint
CREATE TABLE "fact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fact_id" uuid NOT NULL,
	"value" text,
	"normalized_value" text,
	"status" "fact_status" DEFAULT 'DECLARED' NOT NULL,
	"method" "audit_method" DEFAULT 'MANUAL' NOT NULL,
	"actor_account_id" uuid,
	"reason" text,
	"source_document_version_id" uuid,
	"model_version" text,
	"prompt_version" text,
	"schema_version" text,
	"observed_at" timestamp with time zone,
	"effective_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"field_definition_id" uuid NOT NULL,
	"repeating_record_key" text,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"data_type" text NOT NULL,
	"sensitivity" "field_sensitivity" DEFAULT 'STANDARD' NOT NULL,
	"repeating" boolean DEFAULT false NOT NULL,
	"pack_id" text,
	"validation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_definitions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_fact_version_id_fact_versions_id_fk" FOREIGN KEY ("fact_version_id") REFERENCES "public"."fact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_source_document_version_id_document_versions_id_fk" FOREIGN KEY ("source_document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_field_definition_id_field_definitions_id_fk" FOREIGN KEY ("field_definition_id") REFERENCES "public"."field_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_versions_fact_idx" ON "fact_versions" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX "facts_applicant_idx" ON "facts" USING btree ("applicant_id");