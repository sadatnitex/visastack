-- Passkeys that confirm sensitive actions (Q8). Written to be re-runnable: production applies
-- each statement on its own, so a run interrupted part way must be able to start again.
-- A passkey never signs anyone in: it only records that this sign-in was confirmed recently.
CREATE TABLE IF NOT EXISTS "passkey_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"aaguid" text,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_session_ref" text,
	"last_challenge_hash" text,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "passkey_credentials_device_type" CHECK ("passkey_credentials"."device_type" in ('singleDevice', 'multiDevice')),
	CONSTRAINT "passkey_credentials_label_length" CHECK (char_length("passkey_credentials"."label") between 1 and 60),
	CONSTRAINT "passkey_credentials_sign_count" CHECK ("passkey_credentials"."sign_count" >= 0),
	CONSTRAINT "passkey_credentials_credential_id_length" CHECK (char_length("passkey_credentials"."credential_id") between 1 and 1366)
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_credentials_account_idx" ON "passkey_credentials" USING btree ("account_id");
