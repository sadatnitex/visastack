CREATE TYPE "public"."evidence_request_decision_outcome" AS ENUM('ACCEPTED', 'NEEDS_REPLACEMENT', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."evidence_request_status" ADD VALUE 'RECEIVED' BEFORE 'FULFILLED';--> statement-breakpoint
ALTER TYPE "public"."evidence_request_status" ADD VALUE 'UNDER_REVIEW' BEFORE 'FULFILLED';--> statement-breakpoint
ALTER TYPE "public"."evidence_request_status" ADD VALUE 'ACCEPTED' BEFORE 'FULFILLED';--> statement-breakpoint
ALTER TYPE "public"."evidence_request_status" ADD VALUE 'NEEDS_REPLACEMENT' BEFORE 'FULFILLED';--> statement-breakpoint
ALTER TYPE "public"."evidence_request_status" ADD VALUE 'CANCELLED' BEFORE 'FULFILLED';--> statement-breakpoint
CREATE TABLE "evidence_request_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_request_id" uuid NOT NULL,
	"outcome" "evidence_request_decision_outcome" NOT NULL,
	"reason" text,
	"responding_fact_id" uuid,
	"responding_document_id" uuid,
	"decided_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD COLUMN "mission_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD COLUMN "pack_requirement_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD COLUMN "requested_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD COLUMN "responding_fact_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD COLUMN "responding_document_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_request_decisions" ADD CONSTRAINT "evidence_request_decisions_evidence_request_id_evidence_requests_id_fk" FOREIGN KEY ("evidence_request_id") REFERENCES "public"."evidence_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_request_decisions" ADD CONSTRAINT "evidence_request_decisions_responding_fact_id_facts_id_fk" FOREIGN KEY ("responding_fact_id") REFERENCES "public"."facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_request_decisions" ADD CONSTRAINT "evidence_request_decisions_responding_document_id_documents_id_fk" FOREIGN KEY ("responding_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_request_decisions" ADD CONSTRAINT "evidence_request_decisions_decided_by_account_id_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_request_decisions_request_idx" ON "evidence_request_decisions" USING btree ("evidence_request_id");--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_pack_requirement_id_pack_requirements_id_fk" FOREIGN KEY ("pack_requirement_id") REFERENCES "public"."pack_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_requested_by_account_id_accounts_id_fk" FOREIGN KEY ("requested_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_responding_fact_id_facts_id_fk" FOREIGN KEY ("responding_fact_id") REFERENCES "public"."facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_responding_document_id_documents_id_fk" FOREIGN KEY ("responding_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_requests_mission_idx" ON "evidence_requests" USING btree ("mission_id");--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_at_most_one_response_target" CHECK (NOT ("evidence_requests"."responding_fact_id" is not null AND "evidence_requests"."responding_document_id" is not null));