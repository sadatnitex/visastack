CREATE TYPE "public"."mission_outcome_decision" AS ENUM('APPROVED', 'REFUSED', 'WITHDRAWN', 'CANCELLED', 'OTHER');--> statement-breakpoint
CREATE TABLE "mission_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"decision" "mission_outcome_decision" NOT NULL,
	"decision_date" timestamp with time zone NOT NULL,
	"official_wording" text,
	"agency_interpretation" text,
	"evidence_document_id" uuid,
	"actor_account_id" uuid NOT NULL,
	"auth_assurance_context" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_outcomes" ADD CONSTRAINT "mission_outcomes_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_outcomes" ADD CONSTRAINT "mission_outcomes_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_outcomes" ADD CONSTRAINT "mission_outcomes_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_outcomes_mission_idx" ON "mission_outcomes" USING btree ("mission_id");