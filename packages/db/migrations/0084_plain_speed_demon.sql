ALTER TABLE "accounts" ADD COLUMN "neon_user_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_neon_user_id_unique" UNIQUE("neon_user_id");