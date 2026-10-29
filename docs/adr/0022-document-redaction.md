# ADR-0022: Real redaction of documents ("Safe Copies" with masks)

- **Status:** Accepted (architecture freeze, 26 Oct 2026); implementation pending (Sonnet package S23)
- **Date:** 2026-10-26
- **Deciders:** Owner (26 Oct 2026: "payments, AI connector and product now; only security and compliance deferred", which lifts the earlier "real redaction parked" decision); architecture session
- **PRD/Spec link:** EVI-02 and EVI-06 (safe rendered previews); `DOWNLOAD_REDACTED` permission shown as "Download Safe Copies" (owner, 25 Oct); ADR 0012 (conservative PDF handling)

## Context

- `downloadDocument` and `previewDocument` already have a `redacted` variant, gated by `DOWNLOAD_REDACTED` or `PREVIEW` (`packages/services/src/documents.ts`).
- `/api/blob/[key]` serves that variant through `PreviewRendererPort`, which re-renders the file as a fresh image. Content types without a renderer fail closed with 501. The rendition masks nothing, so readiness reports redacted download as disabled.
- Visa photo sizes (`photo-sizing.ts`) show the accepted pattern:
  - a processed copy is made on request from a `requireAccess` proof;
  - hidden data is removed;
  - nothing is stored;
  - one audit event is written, with no image data;
  - the copy has its own rate-limit bucket.
- Private OCR (Tesseract, in the scanner worker) can produce word positions. AI OCR returns text only.

## Decision

1. **Masks belong to the owner.** A new table `redaction_masks` holds one row per document version and page:
   - `document_version_id`, `page`, `boxes` (jsonb list of `{x, y, w, h}` as fractions of the page, 0 to 1);
   - `source` (`OWNER`, `SUGGESTED_ACCEPTED`);
   - `created_by_account_id`, `updated_at`.

   Only the record owner creates or changes masks (owner proof from `requireAccess`). Agencies and other recipients never edit them. A new document version starts with no masks: masks are never copied across versions, because the layout may differ.
2. **The safe copy is rendered, never edited.**
   - Each page (up to 20) is rasterized through the existing renderer.
   - The masks are painted as solid black boxes.
   - The pages are assembled into a new image-only PDF, or one PNG for single images.
   - **No text layer, no metadata, no attachments, no original objects survive.** Rasterizing is what makes removal certain.
   - It is made on request and not stored (as with photo sizes). If timing measured in the pilot demands it, it may be cached later as a derived object.
3. **Availability.** The `redacted` variant serves a masked copy only when the owner has saved masks for that version, or has saved the explicit choice "Nothing to hide on this document". Otherwise the safe copy is "Not Prepared Yet" and nothing is served: no unmasked fallback. Readiness reports redacted download `available` once this ships.
4. **Suggestions, never automatic redaction.** Where private OCR gives word positions, VisaStack suggests boxes for:
   - the passport MRZ zone;
   - values matching the person's own `identifier` and `national_identifier` facts;
   - account-number patterns on financial documents.

   The owner accepts, moves or removes each suggestion and sees a full preview before saving. Never claim that a document is completely redacted. The wording: "Check every page. Only the black boxes are hidden."
5. **Editor.** The editor is a page viewer that lets the owner draw, move and delete boxes, with keyboard support: arrow keys move a box, Shift with an arrow resizes it, Delete removes it. Boxes are listed as text for screen readers. It is built on the existing preview rendering; no new client library unless one already in the repo fits.
6. **Who receives safe copies.** Only grants that include `DOWNLOAD_REDACTED` ("Download Safe Copies"), checked exactly as today. The AI connector can offer "Safe copy only" for original-document access (ADR 0021 extension).
7. **Audit.** `DOCUMENT_REDACTION_SAVED` records counts of boxes and pages. `DOCUMENT_ACCESS` with variant `redacted`. Never image data or box contents.
8. **Limits.** At most 20 pages and 25 MB in; a 30 s render budget; refuse with "This document is too large for a safe copy" beyond that. Restricted document types follow the document protection switches unchanged.

## Consequences

- **Positive:** agencies can receive what they need with the rest hidden, and removal is certain because only pixels survive.
- **Negative:** the safe copy is an image (text is not selectable), multi-page renders cost time, and one migration is needed.
- **Follow-ups:** S23. Caching rendered copies is an option if pilot timing shows renders are too slow.

## Alternatives considered

- **Editing the PDF in place (removing text objects).** Rejected: hidden layers, incremental updates and fonts make leaks likely.
- **Fully automatic redaction.** Rejected: a missed field would be presented as safe. A person always confirms.

## Amendment, 29 Oct 2026 (S23 as built)

Built in package S23 (migration 0102 `redaction_masks`, `packages/services/src/redaction.ts`, `packages/adapters/src/safe-copy-renderer.ts` and `image-pdf-writer.ts`, the Safe Copy section on the Documents screen). The decision above stands; these six points record where the build differs from its text, and why.

1. **Where suggestions come from.** No private OCR word positions exist anywhere: the scanner runs Tesseract to plain text and `extraction_runs` keeps text only. Suggestions therefore come from (a) the PDF's own text layer (pdfjs text positions), read on request and never stored, and (b) for passport kinds (PASSPORT, SPOUSE_PASSPORT, HOST_PASSPORT and their aliases) a fixed band at the bottom of the first page where the machine-readable lines usually sit, offered as a suggestion like any other. Matches: machine-readable lines, the owner's own `identifier` and `national_identifier` values (decrypted in memory for that request only, compared as letters and digits, never logged, stored or returned beyond box positions), and IBAN or 8 to 20 digit account numbers on financial kinds. A scanned image has no text layer, so only the passport band is offered there. Word positions from Tesseract are a follow-up.
2. **How the safe copy is served.** Through a new route, `POST /api/documents/safe-copy`, with a `DOWNLOAD_REDACTED` proof from `requireAccess` (so the restricted-document identity check applies), not through the token-only blob route. The audit keeps `variant: redacted`. The old path is closed: `/api/blob/[key]` refuses any non-original download (`d=download`) with 403, previews are unchanged, and `downloadDocument` with variant `redacted` returns `invalid` and mints no link (it stays in the access baseline because it still takes no proof).
3. **Every page, PDF and images only.** Pages are rasterised up to 20 (the preview still draws page 1). Safe copies are made from PDF, PNG and JPEG files (HEIC uploads are stored as JPEG). DOCX and text files are `UNSUPPORTED`: a text rendering cannot be masked by position. The output is held to 4 MB (JPEG quality is lowered in steps, then the copy is refused as too large), because a hosted function response is limited.
4. **AI connector "Safe copy only".** Not applicable yet: no AI connector tool serves original files today. S20 should offer safe copies through `produceSafeCopy` when it adds file access.
5. **Latest version only.** Boxes can be saved only on the document's latest version that is safe to use, the save names that version, and the page count is checked against the file itself. A new version starts with none. A copy is refused when the latest version is not yet safe to use; it never falls back to an older version.
6. **Rule for future work.** Editor page images show the page unmasked, so they are the record owner's alone (an owner PREVIEW proof). Any future preview for anyone other than the owner must use the masked rendering, never the unmasked one.

Also as built: audit events `DOCUMENT_REDACTION_SAVED` and `DOCUMENT_REDACTION_CLEARED` hold only `documentVersionId`, `pageCount`, `boxCount`, `nothingToHide` and `acceptedSuggestions`; both are replayed by backup reconciliation, failing closed. Boxes are deleted when their file is queued for erasure and go with the version. Rate limits: 30 safe copies, 300 editor page views or suggestion reads, and 60 saves per person per hour. Until migration 0102 runs, every safe copy reads "Not Prepared Yet", nothing is served, and saving says safe copies are not ready yet.
