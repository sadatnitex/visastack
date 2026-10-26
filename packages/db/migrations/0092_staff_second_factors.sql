-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
CREATE TABLE IF NOT EXISTS "staff_second_factors" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"enrolment_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"secret_nonce" "bytea" NOT NULL,
	"secret_key_version" text NOT NULL,
	"last_used_step" bigint,
	"verified_at" timestamp with time zone,
	"verified_session_ref" text,
	"recovery_code_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_second_factors_status" CHECK ("staff_second_factors"."status" in ('PENDING', 'ACTIVE')),
	CONSTRAINT "staff_second_factors_active_confirmed" CHECK ("staff_second_factors"."status" <> 'ACTIVE' or "staff_second_factors"."confirmed_at" is not null),
	CONSTRAINT "staff_second_factors_recovery_max" CHECK (coalesce(array_length("staff_second_factors"."recovery_code_hashes", 1), 0) <= 10)
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "staff_second_factors" ADD CONSTRAINT "staff_second_factors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;