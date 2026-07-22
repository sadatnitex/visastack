ALTER TABLE "accounts" ADD COLUMN "workos_user_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workos_user_id_unique" UNIQUE("workos_user_id");