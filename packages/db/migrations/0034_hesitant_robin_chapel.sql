CREATE TABLE "issuer_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"fact_id" uuid,
	"document_id" uuid,
	"issuer_identity" text NOT NULL,
	"contact_method" text NOT NULL,
	"exact_claim" text NOT NULL,
	"response" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"verified_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issuer_verifications_covers_something" CHECK ("issuer_verifications"."fact_id" is not null or "issuer_verifications"."document_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "issuer_verifications" ADD CONSTRAINT "issuer_verifications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issuer_verifications" ADD CONSTRAINT "issuer_verifications_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issuer_verifications" ADD CONSTRAINT "issuer_verifications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issuer_verifications_applicant_idx" ON "issuer_verifications" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "issuer_verifications_fact_idx" ON "issuer_verifications" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX "issuer_verifications_document_idx" ON "issuer_verifications" USING btree ("document_id");