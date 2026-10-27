-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- WhatsApp channel (Lane D, docs/roadmap/pwa-whatsapp/LANE-D-CONTRACT.md). Additive: four new
-- tables, no change to any existing table. Code tolerates these tables being absent until this runs.
CREATE TABLE IF NOT EXISTS "channel_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text DEFAULT 'WHATSAPP' NOT NULL,
	"provider_scope" text NOT NULL,
	"external_user_id" text NOT NULL,
	"phone_last4" text,
	"status" text DEFAULT 'PROVISIONAL' NOT NULL,
	"account_id" uuid,
	"opt_in_version" text,
	"linked_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"opt_changed_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_auto_reply_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_identities_sender_unique" UNIQUE("channel","provider_scope","external_user_id"),
	CONSTRAINT "channel_identities_channel" CHECK ("channel_identities"."channel" in ('WHATSAPP')),
	CONSTRAINT "channel_identities_status" CHECK ("channel_identities"."status" in ('PROVISIONAL', 'LINKED', 'REVOKED')),
	CONSTRAINT "channel_identities_linked_account" CHECK (("channel_identities"."status" = 'LINKED') = ("channel_identities"."account_id" is not null)),
	CONSTRAINT "channel_identities_last4" CHECK ("channel_identities"."phone_last4" is null or "channel_identities"."phone_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"opt_in_version" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_link_codes_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"error_code" integer,
	"pricing_category" text,
	"billable" boolean,
	"provider_timestamp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_messages_provider_unique" UNIQUE("provider_message_id"),
	CONSTRAINT "channel_messages_direction" CHECK ("channel_messages"."direction" in ('IN', 'OUT')),
	CONSTRAINT "channel_messages_state" CHECK ("channel_messages"."state" in ('RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text DEFAULT 'WHATSAPP' NOT NULL,
	"event_hash" text NOT NULL,
	"payload_ciphertext" "bytea",
	"payload_nonce" "bytea",
	"payload_key_version" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "channel_webhook_events_hash_unique" UNIQUE("event_hash"),
	CONSTRAINT "channel_webhook_events_payload_whole" CHECK (("channel_webhook_events"."payload_ciphertext" is null) = ("channel_webhook_events"."payload_nonce" is null) and ("channel_webhook_events"."payload_nonce" is null) = ("channel_webhook_events"."payload_key_version" is null))
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "channel_link_codes" ADD CONSTRAINT "channel_link_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_identity_id_channel_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_identities_one_linked_per_account" ON "channel_identities" USING btree ("account_id","channel") WHERE "channel_identities"."status" = 'LINKED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_link_codes_account_idx" ON "channel_link_codes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_messages_identity_idx" ON "channel_messages" USING btree ("identity_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_webhook_events_pending_idx" ON "channel_webhook_events" USING btree ("received_at") WHERE "channel_webhook_events"."processed_at" is null;