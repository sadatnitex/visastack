ALTER TABLE "notifications" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
CREATE INDEX "notifications_provider_message_idx" ON "notifications" USING btree ("provider_message_id");