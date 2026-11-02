CREATE TABLE "agency_collection_guest_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_collection_guest_codes_hash" CHECK ("agency_collection_guest_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_collection_guest_codes_attempts" CHECK ("agency_collection_guest_codes"."attempts" >= 0 and "agency_collection_guest_codes"."attempts" <= 5)
);
--> statement-breakpoint
CREATE TABLE "agency_collection_guest_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"retention_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_collection_guest_drafts_link_id_unique" UNIQUE("link_id"),
	CONSTRAINT "agency_collection_guest_drafts_retention_days" CHECK ("agency_collection_guest_drafts"."retention_days" is null or "agency_collection_guest_drafts"."retention_days" in (3, 7, 15, 30, 60, 90, 180))
);
--> statement-breakpoint
CREATE TABLE "agency_collection_guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_hash" text NOT NULL,
	"link_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agency_collection_guest_sessions_session_hash_unique" UNIQUE("session_hash"),
	CONSTRAINT "agency_collection_guest_sessions_hash" CHECK ("agency_collection_guest_sessions"."session_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "agency_collection_guest_codes" ADD CONSTRAINT "agency_collection_guest_codes_session_id_agency_collection_guest_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agency_collection_guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_codes" ADD CONSTRAINT "agency_collection_guest_codes_link_id_agency_collection_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."agency_collection_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_drafts" ADD CONSTRAINT "agency_collection_guest_drafts_link_id_agency_collection_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."agency_collection_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_drafts" ADD CONSTRAINT "agency_collection_guest_drafts_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_drafts" ADD CONSTRAINT "agency_collection_guest_drafts_revision_id_agency_collection_request_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."agency_collection_request_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_sessions" ADD CONSTRAINT "agency_collection_guest_sessions_link_id_agency_collection_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."agency_collection_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_sessions" ADD CONSTRAINT "agency_collection_guest_sessions_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_sessions" ADD CONSTRAINT "agency_collection_guest_sessions_revision_id_agency_collection_request_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."agency_collection_request_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_collection_guest_codes_session_idx" ON "agency_collection_guest_codes" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_codes_link_idx" ON "agency_collection_guest_codes" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_drafts_request_idx" ON "agency_collection_guest_drafts" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_drafts_revision_idx" ON "agency_collection_guest_drafts" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_sessions_link_idx" ON "agency_collection_guest_sessions" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_sessions_request_idx" ON "agency_collection_guest_sessions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_sessions_revision_idx" ON "agency_collection_guest_sessions" USING btree ("revision_id");