CREATE TYPE "public"."case_complaint_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');--> statement-breakpoint
ALTER TYPE "public"."platform_role" ADD VALUE 'QUALITY_ADMIN';--> statement-breakpoint
CREATE TABLE "case_complaint_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complaint_id" uuid NOT NULL,
	"from_status" "case_complaint_status",
	"to_status" "case_complaint_status" NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"filed_by_account_id" uuid NOT NULL,
	"description" text NOT NULL,
	"status" "case_complaint_status" DEFAULT 'OPEN' NOT NULL,
	"owner_account_id" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"submitted_by_account_id" uuid NOT NULL,
	"comments" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_complaint_events" ADD CONSTRAINT "case_complaint_events_complaint_id_case_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."case_complaints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_complaint_events" ADD CONSTRAINT "case_complaint_events_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_complaints" ADD CONSTRAINT "case_complaints_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_complaints" ADD CONSTRAINT "case_complaints_filed_by_account_id_accounts_id_fk" FOREIGN KEY ("filed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_complaints" ADD CONSTRAINT "case_complaints_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_feedback" ADD CONSTRAINT "case_feedback_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_feedback" ADD CONSTRAINT "case_feedback_submitted_by_account_id_accounts_id_fk" FOREIGN KEY ("submitted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_complaint_events_complaint_idx" ON "case_complaint_events" USING btree ("complaint_id");--> statement-breakpoint
CREATE INDEX "case_complaints_mission_idx" ON "case_complaints" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "case_feedback_mission_idx" ON "case_feedback" USING btree ("mission_id");