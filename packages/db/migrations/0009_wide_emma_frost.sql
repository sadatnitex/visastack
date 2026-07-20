CREATE TABLE "storage_blobs" (
	"object_key" text PRIMARY KEY NOT NULL,
	"bucket" "storage_bucket" NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
