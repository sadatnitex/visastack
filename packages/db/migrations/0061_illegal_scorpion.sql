CREATE TYPE "public"."acknowledgement_decision" AS ENUM('ACKNOWLEDGED', 'REJECTED', 'CORRECTION_REQUESTED');--> statement-breakpoint
CREATE TABLE "acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"subject_applicant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_checksum" text NOT NULL,
	"case_material_revision" integer NOT NULL,
	"decision" "acknowledgement_decision" NOT NULL,
	"reason" text,
	"actor_account_id" uuid NOT NULL,
	"actor_authority" "applicant_relationship" NOT NULL,
	"text_version" integer NOT NULL,
	"auth_assurance_context" jsonb NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_subject_applicant_id_applicants_id_fk" FOREIGN KEY ("subject_applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_snapshot_id_mission_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."mission_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acknowledgements_mission_idx" ON "acknowledgements" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "acknowledgements_snapshot_idx" ON "acknowledgements" USING btree ("snapshot_id");