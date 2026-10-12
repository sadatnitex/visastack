CREATE TABLE "sharing_invitations" (
	"mission_id" uuid,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"invited_by_account_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"purpose" text NOT NULL,
	"actions" "permission_action"[] NOT NULL,
	"categories" text[],
	"document_ids" uuid[],
	"document_scope_snapshot" uuid[],
	"grant_expiry_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"step_up_satisfied" boolean DEFAULT false NOT NULL,
	"accepted_grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sharing_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sharing_invitations_status_check" CHECK ("sharing_invitations"."status" in ('PENDING', 'ACCEPTED', 'REVOKED'))
);
--> statement-breakpoint
ALTER TABLE "sharing_invitations" ADD CONSTRAINT "sharing_invitations_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharing_invitations" ADD CONSTRAINT "sharing_invitations_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharing_invitations" ADD CONSTRAINT "sharing_invitations_invited_by_account_id_accounts_id_fk" FOREIGN KEY ("invited_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharing_invitations" ADD CONSTRAINT "sharing_invitations_accepted_grant_id_grants_id_fk" FOREIGN KEY ("accepted_grant_id") REFERENCES "public"."grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sharing_invitations_applicant_idx" ON "sharing_invitations" USING btree ("applicant_id","status");