ALTER TABLE "applicants" ADD COLUMN "authority_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "itinerary_ref" text;