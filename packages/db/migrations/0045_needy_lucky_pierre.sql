CREATE TYPE "public"."contributor_request_status" AS ENUM('PENDING', 'SUBMITTED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "contributor_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"requested_by_account_id" uuid,
	"contributor_email" text NOT NULL,
	"doc_type" text NOT NULL,
	"purpose" text NOT NULL,
	"message" text,
	"token_hash" text NOT NULL,
	"status" "contributor_request_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"allow_wallet_reuse" boolean DEFAULT false NOT NULL,
	"contributor_account_id" uuid,
	"submitted_document_id" uuid,
	"submitted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributor_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "wallet_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contributor_requests" ADD CONSTRAINT "contributor_requests_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_requests" ADD CONSTRAINT "contributor_requests_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_requests" ADD CONSTRAINT "contributor_requests_requested_by_account_id_accounts_id_fk" FOREIGN KEY ("requested_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_requests" ADD CONSTRAINT "contributor_requests_contributor_account_id_accounts_id_fk" FOREIGN KEY ("contributor_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_requests" ADD CONSTRAINT "contributor_requests_submitted_document_id_documents_id_fk" FOREIGN KEY ("submitted_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contributor_requests_mission_idx" ON "contributor_requests" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "contributor_requests_applicant_idx" ON "contributor_requests" USING btree ("applicant_id");