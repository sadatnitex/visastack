CREATE TABLE "document_protection_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"restricted" boolean NOT NULL,
	"reason" text,
	"changed_by_account_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_protection_settings_scope_key_unique" UNIQUE("scope","key"),
	CONSTRAINT "document_protection_settings_scope_valid" CHECK ("document_protection_settings"."scope" in ('CATEGORY', 'DOCUMENT_TYPE', 'UNKNOWN_TYPE')),
	CONSTRAINT "document_protection_settings_unknown_key" CHECK ("document_protection_settings"."scope" <> 'UNKNOWN_TYPE' or "document_protection_settings"."key" = 'unknown'),
	CONSTRAINT "document_protection_settings_key_length" CHECK (char_length("document_protection_settings"."key") between 1 and 120),
	CONSTRAINT "document_protection_settings_reason_length" CHECK ("document_protection_settings"."reason" is null or char_length("document_protection_settings"."reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "document_protection_settings" ADD CONSTRAINT "document_protection_settings_changed_by_account_id_accounts_id_fk" FOREIGN KEY ("changed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;