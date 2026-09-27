ALTER TABLE "legal_holds" ADD COLUMN "mission_id" uuid;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_holds_mission_idx" ON "legal_holds" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "legal_holds_document_idx" ON "legal_holds" USING btree ("document_id");