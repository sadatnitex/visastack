CREATE TYPE "public"."upload_intent_status" AS ENUM('RESERVED', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"reserved_bytes" bigint NOT NULL,
	"status" "upload_intent_status" DEFAULT 'RESERVED' NOT NULL,
	"document_version_id" uuid,
	"failure_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_intents_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_intents_applicant_status_idx" ON "upload_intents" USING btree ("applicant_id","status");--> statement-breakpoint
CREATE INDEX "upload_intents_account_status_idx" ON "upload_intents" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "upload_intents_status_expires_idx" ON "upload_intents" USING btree ("status","expires_at");