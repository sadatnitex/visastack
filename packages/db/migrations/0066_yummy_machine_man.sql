ALTER TABLE "missions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "retention_notice_sent_at" timestamp with time zone;