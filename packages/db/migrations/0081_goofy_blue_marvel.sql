CREATE TABLE "ai_explanation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_requirement_id" uuid NOT NULL,
	"status" "ai_extraction_run_status" NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text,
	"cost_units" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_request_id" text,
	"input_units" integer,
	"output_units" integer,
	"cached_units" integer,
	"latency_ms" integer,
	"error_code" text,
	"cache_key" text,
	"served_from_cache_run_id" uuid,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_explanation_runs" ADD CONSTRAINT "ai_explanation_runs_pack_requirement_id_pack_requirements_id_fk" FOREIGN KEY ("pack_requirement_id") REFERENCES "public"."pack_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_explanation_runs_pack_requirement_idx" ON "ai_explanation_runs" USING btree ("pack_requirement_id");--> statement-breakpoint
CREATE INDEX "ai_explanation_runs_cache_key_idx" ON "ai_explanation_runs" USING btree ("cache_key");