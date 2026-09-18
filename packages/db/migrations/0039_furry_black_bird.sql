CREATE TYPE "public"."client_invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "client_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"case_owner_account_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"contact_destination" text NOT NULL,
	"requested_route" text,
	"token_hash" text NOT NULL,
	"status" "client_invitation_status" DEFAULT 'PENDING' NOT NULL,
	"invited_by_account_id" uuid NOT NULL,
	"accepted_by_account_id" uuid,
	"accepted_applicant_id" uuid,
	"accepted_mission_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "client_invitations" ADD CONSTRAINT "client_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invitations" ADD CONSTRAINT "client_invitations_case_owner_account_id_accounts_id_fk" FOREIGN KEY ("case_owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invitations" ADD CONSTRAINT "client_invitations_invited_by_account_id_accounts_id_fk" FOREIGN KEY ("invited_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invitations" ADD CONSTRAINT "client_invitations_accepted_by_account_id_accounts_id_fk" FOREIGN KEY ("accepted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invitations" ADD CONSTRAINT "client_invitations_accepted_applicant_id_applicants_id_fk" FOREIGN KEY ("accepted_applicant_id") REFERENCES "public"."applicants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invitations" ADD CONSTRAINT "client_invitations_accepted_mission_id_missions_id_fk" FOREIGN KEY ("accepted_mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_invitations_org_status_idx" ON "client_invitations" USING btree ("organization_id","status");