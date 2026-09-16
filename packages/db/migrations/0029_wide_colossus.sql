CREATE TABLE "audit_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_seq" bigint NOT NULL,
	"to_seq" bigint NOT NULL,
	"chain_head_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signing_key_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_checkpoints_range_valid" CHECK ("audit_checkpoints"."to_seq" >= "audit_checkpoints"."from_seq")
);
--> statement-breakpoint
CREATE INDEX "audit_checkpoints_to_seq_idx" ON "audit_checkpoints" USING btree ("to_seq");--> statement-breakpoint
CREATE RULE "audit_checkpoints_no_update" AS ON UPDATE TO "audit_checkpoints" DO INSTEAD NOTHING;--> statement-breakpoint
CREATE RULE "audit_checkpoints_no_delete" AS ON DELETE TO "audit_checkpoints" DO INSTEAD NOTHING;