CREATE TABLE "data_keys" (
	"key_version" text PRIMARY KEY NOT NULL,
	"wrapped_data_key" "bytea" NOT NULL,
	"algorithm" text DEFAULT 'AES-256-GCM' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "support_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"actions" "permission_action"[] NOT NULL,
	"reason" text NOT NULL,
	"approved_by_account_id" uuid NOT NULL,
	"start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expiry_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_account_id" uuid,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_grants_approver_not_actor" CHECK ("support_grants"."approved_by_account_id" <> "support_grants"."actor_account_id"),
	CONSTRAINT "support_grants_max_duration" CHECK (extract(epoch from ("support_grants"."expiry_at" - "support_grants"."start_at")) <= 3600),
	CONSTRAINT "support_grants_expiry_after_start" CHECK ("support_grants"."expiry_at" > "support_grants"."start_at")
);
--> statement-breakpoint
ALTER TABLE "fact_versions" ADD COLUMN "value_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "fact_versions" ADD COLUMN "value_nonce" "bytea";--> statement-breakpoint
ALTER TABLE "fact_versions" ADD COLUMN "protected_key_version" text;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_approved_by_account_id_accounts_id_fk" FOREIGN KEY ("approved_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_revoked_by_account_id_accounts_id_fk" FOREIGN KEY ("revoked_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_grants_applicant_idx" ON "support_grants" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "support_grants_actor_idx" ON "support_grants" USING btree ("actor_account_id");--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_protection_exclusive" CHECK ((
        "fact_versions"."value" is null or "fact_versions"."value_ciphertext" is null
      ) and (
        ("fact_versions"."value_ciphertext" is null) = ("fact_versions"."value_nonce" is null)
        and ("fact_versions"."value_ciphertext" is null) = ("fact_versions"."protected_key_version" is null)
      ));