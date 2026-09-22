CREATE TYPE "public"."notification_channel" AS ENUM('IN_APP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'READ');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"idempotency_key" text NOT NULL,
	"recipient_account_id" uuid,
	"recipient_email" text,
	"applicant_id" uuid,
	"organization_id" uuid,
	"mission_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "notifications_recipient_present" CHECK ("notifications"."recipient_account_id" is not null or "notifications"."recipient_email" is not null)
);
--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "timezone" text DEFAULT 'Asia/Dhaka' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_account_id_accounts_id_fk" FOREIGN KEY ("recipient_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_dispatch_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_account_id");