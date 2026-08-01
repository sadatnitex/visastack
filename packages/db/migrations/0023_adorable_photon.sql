CREATE TYPE "public"."generated_output_kind" AS ENUM('COVER_LETTER');--> statement-breakpoint
CREATE TYPE "public"."mission_decision_outcome" AS ENUM('ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."mission_task_status" AS ENUM('OPEN', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "generated_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"kind" "generated_output_kind" NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"grounded_references" jsonb NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"translated_from_output_id" uuid,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_outputs_mission_kind_version_unique" UNIQUE("mission_id","kind","version")
);
--> statement-breakpoint
CREATE TABLE "mission_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"pack_requirement_id" uuid NOT NULL,
	"outcome" "mission_decision_outcome" NOT NULL,
	"reason" text,
	"decided_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"pack_requirement_id" uuid,
	"description" text NOT NULL,
	"assignee_account_id" uuid,
	"status" "mission_task_status" DEFAULT 'OPEN' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selected_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"pack_requirement_id" uuid NOT NULL,
	"fact_id" uuid,
	"document_id" uuid,
	"selected_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selected_evidence_requirement_fact_unique" UNIQUE("mission_id","pack_requirement_id","fact_id"),
	CONSTRAINT "selected_evidence_requirement_document_unique" UNIQUE("mission_id","pack_requirement_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "generated_outputs" ADD CONSTRAINT "generated_outputs_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_decisions" ADD CONSTRAINT "mission_decisions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_decisions" ADD CONSTRAINT "mission_decisions_pack_requirement_id_pack_requirements_id_fk" FOREIGN KEY ("pack_requirement_id") REFERENCES "public"."pack_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_tasks" ADD CONSTRAINT "mission_tasks_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_tasks" ADD CONSTRAINT "mission_tasks_pack_requirement_id_pack_requirements_id_fk" FOREIGN KEY ("pack_requirement_id") REFERENCES "public"."pack_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selected_evidence" ADD CONSTRAINT "selected_evidence_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selected_evidence" ADD CONSTRAINT "selected_evidence_pack_requirement_id_pack_requirements_id_fk" FOREIGN KEY ("pack_requirement_id") REFERENCES "public"."pack_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selected_evidence" ADD CONSTRAINT "selected_evidence_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selected_evidence" ADD CONSTRAINT "selected_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_outputs_mission_idx" ON "generated_outputs" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "mission_decisions_mission_idx" ON "mission_decisions" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "mission_tasks_mission_idx" ON "mission_tasks" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "selected_evidence_mission_idx" ON "selected_evidence" USING btree ("mission_id");