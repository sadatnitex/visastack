# P9 plan: guest uploads, exact submission and agency review (Lane D2)

Branch umpe/p9-guest-upload from origin/main 0a0957f. Switch AGENCY_COLLECTION_REQUESTS stays off.

## Schema (one TEMP migration, additive, re-runnable)
- agency_collection_guest_files: request-scoped file (request, link, recipient_key = SHA-256 of the link's email, upload_id unique per request and recipient, opaque object key, size, SHA-256, content type, private original name capped 180, safety RECEIVING / CLEAN / REJECTED, scanner name and version, virus_scanned, item mapping with PROPOSED or GUEST source, removed_at). No applicant, account or document column.
- agency_collection_guest_submissions (+ _items): immutable exact-file manifest (revision, link, recipient_key, submission_no, retention_days, consent version, content SHA-256). UPDATE always refused; DELETE only by cascade or the purge's transaction-local setting.
- agency_collection_reviews: append-only Received / Needs Correction / Accepted per answer, either source (account response id or guest submission id), with a note per item.
- agency_collection_guest_holds: an agency legal hold on a request's guest files; purge skips it.
- agency_collection_guest_sessions.account_seen_at: signed-in idle clock (item 7).

## Services (leased files only)
- umpe-guest-uploads.ts: addGuestFile (P3-style receipt claim adapted to request scope: same upload id answers with the stored file, stale claim after 2 min, 503 while in flight), synchronous scan through the existing MalwareScannerPort and ContentLimitsPort, deterministic mapping proposal from the file name (no AI call), map / remove, desk file list with still-missing, submitGuestDocuments (needs retention and consent; only CLEAN mapped files; appended submission_no), guest view of own submissions and review notes.
- umpe-guest-agency.ts: agency list of guest submissions as CollectionResponseItemView with source 'guest', file download (fresh sign-in, SHA-256 re-check, audited), holds.
- umpe-collection-response-review.ts: review decisions for both sources (account through collectionResponseAccess).
- umpe-guest-retention.ts: SystemScope purge of files, bytes and rows when the request closed + chosen days passed (never under a hold), plus dead sessions and codes of closed links.
- umpe-guest-collection.ts: shared live-session helper; signed-in idle window 2 h on account_seen_at; guest stays 30 min.
- umpe-collection-request-service.ts (shared, two lines): every link inherits the request's recipient email.
- notifications.ts (one block): AGENCY_COLLECTION_RESPONSE_SUBMITTED send-time check accepts a live guest submission (no new event type). rate-limit.ts (one block): guest upload and submit limits.

## Web
- /collect/upload route (cookie path /collect), guest uploader reusing ImportQueue with an injected send, file list with mapping select, remove, still missing, submit form, earlier submissions with review notes.
- Agency request page: answers panel shows guest submissions in the same queue, review forms, guest file download route with fresh sign-in, legal hold form.
- process-erasure daily job route runs the guest purge (SystemScope made in the route file). No scheduler change.

## Tests
No accounts or applicants rows; another guest or agency cannot read; forwarded link shows only the neutral desk; correction appends; purge at the chosen period and never under hold; 85 files settle; ratchet extended; two guards proven red.
