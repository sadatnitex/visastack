CREATE TYPE "public"."platform_role" AS ENUM('PLATFORM_OWNER', 'SECURITY_ADMIN', 'COMPLIANCE_ADMIN', 'SUPPORT_ADMIN');--> statement-breakpoint
CREATE TABLE "platform_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"workos_user_id" text,
	"role" "platform_role" NOT NULL,
	"assigned_by_account_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_account_id" uuid,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_assigned_by_account_id_accounts_id_fk" FOREIGN KEY ("assigned_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_revoked_by_account_id_accounts_id_fk" FOREIGN KEY ("revoked_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_roles_account_idx" ON "platform_roles" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "platform_roles_active_idx" ON "platform_roles" USING btree ("account_id","revoked_at");