# P2 discovery: universal document intake (HEAD d17d717c, read-only)

## 1. Upload UI
- Only uploader: apps/web/src/app/app/applicant/[id]/document-uploader.tsx (550 lines). Mounted once, documents/page.tsx:1082, per applicant (applicantId prop). Other file inputs (profile photo, replace-action, contributor evidence, agency branding/invoices) are unrelated.
- Multi-file: yes, `<input type="file" multiple accept=...>` :363-367 plus separate camera input (capture="environment") :381-383. Drag-drop of files: onDragOver/onDrop :250-265 reads `dataTransfer.files` only. No webkitdirectory, no `webkitGetAsEntry`, so folders and nested folders are unsupported (a dropped folder yields nothing useful).
- Cap: `MAX_FILES_AT_ONCE = 20` :24; extras become `not_sent` lines :181-188 (the 21st+ file is NOT queued).
- Queue: client state `items` with status waiting/sending/checking/added/refused/unknown/not_sent :31-39; effect :202-240 sends strictly one at a time (`running` ref). Concurrency 1, per-file progress via XHR, per-file Try Again for refused/unknown (RETRYABLE :463). No auto-retry, no backoff, no persistence (a reload loses the queue), no pause/stop.
- A kind select (optional, default Not Sure Yet) :274-296; it applies to the batch just added then resets :195-198.

## 2. Transport
- Body goes THROUGH the server, not presigned R2. apps/web/src/lib/document-upload-client.ts:50-76 (XHR, one raw-body POST per file, 5 min timeout, `UPLOAD_UNKNOWN_OUTCOME` for no answer; readAnswer :82-120) to apps/web/src/app/api/documents/upload/route.ts (POST :58-99).
- Limit 4 MB: `STREAM_UPLOAD_LIMIT` apps/web/src/lib/upload-preflight.ts:12; route returns 413 :62-64; also `quota.maxUploadBytes` min (upload-preflight.ts:18).
- Checks: origin same-site :60, applicantId must be a UUID :66, ownership :72, `validateUploadBytes` / `admitsHeicUpload` magic-byte vs MIME :81-84 (415). PDF only when `pdfUploadsAccepted()` (needs a real scanner).
- Route sets `new File([...], 'document')` :91, so the ORIGINAL FILE NAME IS NOT SENT (no header for it). Folder relative paths and names are lost today.
- Action: uploadDocumentAction actions.ts:199+: ownership, file size, `reserveUpload` quota (packages/services/src/uploads.ts:190; rate limit UPLOAD_RESERVE 200/hour, rate-limit.ts:45), sha256 :~330, put to QUARANTINE storage, read-back verify, `registerDocumentWithVersion`, `enqueueIntakeJob` :416, `finalizeUpload`, `after(triggerIntakeAndReading)`.
- Idempotency: NONE on the client request. No client upload id; a retry of an "unknown" request registers a second document; exact duplicates are detected only afterwards by hash (advisory, below). Scan/quarantine: documents start QUARANTINED, `listScanResults` intake.ts:766; unsafe goes NEEDS_ATTENTION.

## 3. Owner and type first?
- Owner: YES required. Route needs `applicantId` query param (route.ts:66-67); no unassigned/staging/inbox concept for documents (grep hits only WhatsApp inbox, `api/staging/attestation` is unrelated). Type: NO, optional (kind "Not Sure Yet", route.ts 87-88 passes '').
- packages/services/src/intake.ts (1024 lines): the pipeline QUARANTINED, SCANNING, NORMALIZING (content limits 50 pages / 40 MP), EXTRACTING, AWAITING_REVIEW/NEEDS_ATTENTION; `processIntake` :782, `nextIntakeState` :96, `getLatestExtractedText` :742, `listScanResults` :766. Idempotent resumable steps.

## 4. Automatic reading (ADR 0019, docs/adr/0019-automatic-document-reading.md)
- Order: deterministic text + MRZ first (intake.ts:536 `classifyDocumentText`, classification.ts:111, `findTd3Block` :33; MRZ suggestions mrz-suggestions.ts, stored intake.ts:337-367 as zero-cost `deterministic:` runs), private OCR only in scanner worker, then consented AI (`processAiReading` ai-reading.ts:209, job key ai-reading-job.ts:18, enqueued from intake.ts:331 per version id + READER_VERSION).
- Proposals: persisted rows `extraction_runs`, `document_classifications` (schema.ts:1084,1112), `document_type_proposals` (:1189), `document_name_versions`, `field_proposals`; confident classification and name wait for approval (intake.ts:590-600; document-suggestion.ts `decideDocumentSuggestion` :100). No "intake_proposals" table exists (the intake-proposals.test.ts name is only a test file). AI is proposal-only; consent + restricted-doc kinds gate it.
- Person attribution: NONE; the applicant is bound at upload. ADR 0019 item 5 binding check version-to-applicant exists only as a guard.

## 5. Duplicates
- Exact hash only: `findDuplicateVersions` documents.ts:~556-596 (same applicant, any version, excluding deleted), called actions.ts:~426; yields a note and `removableCopyId` (Remove This New Copy, LC-C). Versions: `addDocumentVersion` (documents.ts ~360-390, versionNumber++, replace flow under documents/manage/replace). No statement-period, renewed-passport or semantic relation logic (grep for period found only billing).

## 6. Tests (names)
- apps/web/src/app/app/applicant/[id]/document-uploader.test.tsx (labels, keyboard, unknown line, announcements, scanning claims, Remove This New Copy)
- document-uploader-camera.test.tsx ("adding several files at once": one at a time; "takes no more than the limit in one go"; drop area; unknown outcome; upgrade line)
- document-uploader-kind.test.tsx; upload-kind-action.test.ts; upgrade-line-action.test.ts
- apps/web/src/lib/document-upload-client.test.ts, upload-preflight.test.ts, upload-rules.test.ts
- apps/web/src/app/api/documents/upload/route.test.ts; packages/services/src/uploads.test.ts, intake.test.ts, intake-proposals.test.ts, classification.test.ts

## I01-I16 actual status
| ID | Status | Evidence |
|---|---|---|
| I01 | IMPLEMENTED | multiple + onDrop, uploader.tsx:363,261 (files only) |
| I02 | PARTIAL | kind optional, but applicant mandatory and uploader only on documents page :1082 |
| I03 | MISSING | no webkitdirectory/entries |
| I04 | PARTIAL | cap 20, concurrency 1, no persistence/auto-retry |
| I05 | IMPLEMENTED | checkChosenFile + 4MB gate, 413/415 |
| I06 | IMPLEMENTED | QUARANTINED..AWAITING_REVIEW states, intake.ts |
| I07 | PARTIAL | deterministic classify exists; no batch/unknown exception queue |
| I08 | PARTIAL | name suggestions, approval needed |
| I09 | MISSING | applicantId bound at upload, no attribution |
| I10 | PARTIAL | MRZ + AI field_proposals, per-doc review |
| I11 | PARTIAL | per-doc review only |
| I12 | IMPLEMENTED | MRZ suggestions tied to version (intake.ts:337) |
| I13 | PARTIAL | sha256 dup + versions; no period/renewal logic |
| I14 | PARTIAL | expiry/insights exist, not batch triggered |
| I15 | IMPLEMENTED | AI_OCR/EXTRACTION consent + restricted kinds |
| I16 | PARTIAL | UNKNOWN line exists, but no idempotency key, retry can duplicate |

## Smallest additive design (80+ files)
Per-file path stays (/api/documents/upload with applicantId). Owner required today, so P2 batch import targets a chosen applicant (default: the current/only one); "unassigned" needs schema (propose to schema captain; do not do in P2).
New files (namespaced, apps/web/src/lib/import/ and apps/web/src/app/app/applicant/[id]/import/):
- import-queue.ts: pure bounded queue (concurrency 2-3, items by file ref, retry w/ backoff for network unknown only after checking, pause/stop, per-file states queued/uploading/added/duplicate/refused/unknown/unsupported); wraps existing `sendDocumentFile`.
- folder-entries.ts: `webkitGetAsEntry` recursive walk (async readEntries loops until empty) + `<input webkitdirectory>` `webkitRelativePath`; fallback to plain multi-file; sanitize relative path (strip .., control chars); client only, no server traversal.
- import-manifest.ts: IndexedDB/localStorage manifest (name,size,lastModified,status) for resume; user re-selects the same folder, files matched by name+size+lastModified, completed ones skipped.
- import-panel.tsx (+ tests) using ImportQueue, shows summary and per-file honest states, virtualised list for 80+.
- Tests per fixtures: 80 files, 21st not lost, network-timeout mock, unsupported/oversize/false MIME, mobile input, keyboard.
Existing files to change (minimal, need lead lease): 
1. document-uploader.tsx, ONLY to lift `MAX_FILES_AT_ONCE`/replace sequential effect, or better leave it and mount the new panel beside it. Hot file: it is the single shared uploader (and document-uploader*.test.tsx pin 20-cap).
2. documents/page.tsx :1082 to mount the panel (hot, huge).
3. Optionally route.ts to accept `X-Upload-Id` idempotency header and original name header (route.ts:91). A real idempotent confirm needs a service/schema change (uploadIntents client key) in uploads.ts + schema.ts migration (hot, serialized slot). Without it, before retrying an "unknown" file the queue must list the applicant's documents (size/name/hash) to avoid invisible duplicates.
Do not touch: intake.ts, documents.ts, ai-reading.ts, classification.ts. Quotas: UPLOAD_RESERVE 200/hour, 4 MB, per-person storage cap will limit 80 files.
