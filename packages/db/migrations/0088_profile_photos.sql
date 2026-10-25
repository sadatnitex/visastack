ALTER TYPE "public"."erasure_job_reason" ADD VALUE 'PROFILE_PHOTO_REMOVAL';--> statement-breakpoint
CREATE TABLE "applicant_photos" (
	"applicant_id" uuid PRIMARY KEY NOT NULL,
	"storage_object_id" uuid NOT NULL,
	"content_sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicant_photos_storage_object_id_unique" UNIQUE("storage_object_id"),
	CONSTRAINT "applicant_photos_sha256_format" CHECK ("applicant_photos"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "applicant_photos_size_bounds" CHECK ("applicant_photos"."size_bytes" between 1 and 1048576)
);
--> statement-breakpoint
ALTER TABLE "applicant_photos" ADD CONSTRAINT "applicant_photos_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_photos" ADD CONSTRAINT "applicant_photos_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE cascade ON UPDATE no action;