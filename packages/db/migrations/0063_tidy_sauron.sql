CREATE TYPE "public"."mission_submission_channel" AS ENUM('EMBASSY_PORTAL', 'EMAIL', 'IN_PERSON', 'COURIER', 'VISA_APPLICATION_CENTER', 'OTHER');--> statement-breakpoint
CREATE TABLE "mission_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"channel" "mission_submission_channel" NOT NULL,
	"external_report_description" text NOT NULL,
	"external_reference" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"auth_assurance_context" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_submissions" ADD CONSTRAINT "mission_submissions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_submissions" ADD CONSTRAINT "mission_submissions_snapshot_id_mission_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."mission_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_submissions" ADD CONSTRAINT "mission_submissions_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_submissions_mission_idx" ON "mission_submissions" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "mission_submissions_snapshot_idx" ON "mission_submissions" USING btree ("snapshot_id");