CREATE TYPE "public"."task_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
ALTER TYPE "public"."mission_task_status" ADD VALUE 'IN_PROGRESS' BEFORE 'DONE';--> statement-breakpoint
CREATE TABLE "mission_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assignee_account_id" uuid,
	"local_date_time" timestamp NOT NULL,
	"timezone" text NOT NULL,
	"place" text,
	"channel" text,
	"status" "mission_task_status" DEFAULT 'OPEN' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_tasks" ADD COLUMN "due_timezone" text;--> statement-breakpoint
ALTER TABLE "mission_tasks" ADD COLUMN "priority" "task_priority" DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_appointments" ADD CONSTRAINT "mission_appointments_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_appointments" ADD CONSTRAINT "mission_appointments_assignee_account_id_accounts_id_fk" FOREIGN KEY ("assignee_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_appointments_mission_idx" ON "mission_appointments" USING btree ("mission_id");