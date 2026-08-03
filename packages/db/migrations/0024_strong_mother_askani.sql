CREATE TABLE "pilot_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"invited_by_account_id" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_account_id" uuid,
	"revoked_reason" text,
	"accepted_at" timestamp with time zone,
	"accepted_account_id" uuid
);
--> statement-breakpoint
ALTER TABLE "platform_roles" DROP CONSTRAINT "platform_roles_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_roles" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pilot_invitations" ADD CONSTRAINT "pilot_invitations_invited_by_account_id_accounts_id_fk" FOREIGN KEY ("invited_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_invitations" ADD CONSTRAINT "pilot_invitations_revoked_by_account_id_accounts_id_fk" FOREIGN KEY ("revoked_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_invitations" ADD CONSTRAINT "pilot_invitations_accepted_account_id_accounts_id_fk" FOREIGN KEY ("accepted_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pilot_invitations_email_idx" ON "pilot_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_invitations_active_unique_idx" ON "pilot_invitations" USING btree ("email") WHERE "pilot_invitations"."revoked_at" is null and "pilot_invitations"."accepted_at" is null;--> statement-breakpoint
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;