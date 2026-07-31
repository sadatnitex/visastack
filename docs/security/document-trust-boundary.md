# Document Trust Boundary

Authority: master recovery directive §7 "PR 3"; Build Spec §6/§7/§11.
Companion to [threat-model.md](./threat-model.md)'s "malicious upload" row —
this document is the concrete control-to-test map for that row, maintained
as document-handling-relevant code changes.

A document version's `safetyStatus`/`processingStatus` are the only source
of truth for whether it may ever be served. Nothing about a document —
its declared content type, its filename, the actor requesting it, or how it
was uploaded — grants access on its own; every byte-serving path re-derives
"is this actually safe to hand back" from those two fields on every request.

## Serving boundary

| Control | Enforcement | Verified by |
|---|---|---|
| A version is never previewed/downloaded unless it has been confirmed `CLEAN` by the scanner AND reached a servable pipeline state | `accessDocument()` (`packages/services/src/documents.ts`) checks `version.safetyStatus === 'CLEAN'` and `isServableProcessingState(version.processingStatus)` — a positive allow-list (`AWAITING_REVIEW`, `APPROVED`), so an unknown future state fails closed by construction — after authorization succeeds and before any storage read | `documents.test.ts` (all preview/download tests use a fixture that must explicitly mark itself `CLEAN`/`APPROVED` — a version left at its real pipeline defaults is refused) |
| The check never leaks safety state to an unauthorized actor | The safety-state gate runs strictly after the `authorize()` decision, so a stranger with no grant gets the same `forbidden` either way | `documents.ts` code structure (see `accessDocument`) |
| The UI's "Preview" affordance matches the service-layer gate exactly | `isServableProcessingState()` is exported from `packages/services` and imported directly by the applicant page — one canonical definition of "servable," never two independently-maintained conditions that could drift | `apps/web/src/app/app/applicant/[id]/page.tsx` |
| Every scan attempt is durable, auditable evidence — not just the latest outcome | `document_scan_results` (migration `0017`) is an append-only table: scanner name, scanner version, safe/detail, timestamp, one row per attempt; `processIntake` (`packages/services/src/intake.ts`) inserts a row on every SCANNING step, success or failure | Exercised by every pipeline test that reaches the SCANNING step; read via `listScanResults()` |
| A ZIP magic-byte match is never treated as "this is a DOCX" | `validateDocxStructure()` (`packages/adapters/src/docx-validation.ts`) reads the real ZIP central directory (`zip-structure.ts` — structural read only, no entry content ever decompressed) and requires the genuine OOXML Word-document shape | `docx-validation.test.ts`, `zip-structure.test.ts`, and the scanner-level regression test in `adapters.test.ts` ("rejects a zip-shaped upload that is not actually a valid DOCX") |
| XLSX/PPTX cannot pass as DOCX | Rejects when `xl/workbook.xml` or `ppt/presentation.xml` is present | `docx-validation.test.ts` → "rejects an XLSX" |
| Macro-enabled documents (.docm shape) are rejected in the controlled pilot | Rejects when `word/vbaProject.bin` is present | `docx-validation.test.ts` → "rejects a macro-enabled document" |
| Encrypted ZIP entries are rejected | Rejects when any central-directory entry's general-purpose bit 0 is set | `docx-validation.test.ts` → "rejects an encrypted entry"; `zip-structure.test.ts` parses the flag directly |
| Path traversal in an archive entry name is rejected | Rejects `..` segments, absolute paths, and Windows drive-letter paths in any entry name | `docx-validation.test.ts` → "rejects path traversal" |
| Zip-bomb-shaped archives are rejected | Bounded structural read (max 512 entries, rejected outright — not truncated — if exceeded); per-entry uncompressed-size cap (100 MB); aggregate uncompressed-size cap (300 MB); per-entry declared compression-ratio cap (100:1) | `docx-validation.test.ts` → the entry-count/size-limit/compression-ratio tests |
| A PDF carrying active-content markers (embedded JavaScript, auto-launch actions, embedded files) is rejected | `containsActivePdfContent()` (`packages/adapters/src/scanner.ts`) — a bounded byte-level marker search (`/JavaScript`, `/JS`, `/OpenAction`, `/Launch`, `/EmbeddedFile`) | `adapters.test.ts` → "rejects a PDF containing an active-content marker" |
| HTML/SVG cannot be smuggled in as TXT/MD via a spoofed declared content type | The plain-text path is gated on the exact declared content type (`text/plain`/`text/markdown`), never on "decodes as clean UTF-8" alone | `adapters.test.ts` → "rejects HTML/SVG content declared under a spoofed content type" (pre-existing, still enforced) |
| Extracted/retained text is never unbounded | `capExtractedText()` (`packages/services/src/extraction.ts`) caps retained text at 20,000 characters, flagging truncation | `text-extraction.test.ts` → "truncates text beyond the retention cap" |
| A served object never executes as markup, never gets MIME-sniffed, and is never cached | `/api/blob/[key]` sets `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: default-src 'none'; sandbox` on every response | `headers.test.ts` (`apps/web/src/app/api/blob/[key]/`) |
| The private storage URL is never exposed to the browser | `issueReadRef` always mints a signed reference to the app's own `/api/blob/[key]` route — never a direct Vercel Blob/Neon URL | `vercel-blob.test.ts` → "issueReadRef mints a signed reference to the app's own serving route, never a direct Vercel URL" |

## What this does NOT yet cover (tracked, not silently dropped)

- **Real antivirus / signature-based scanning.** `BasicSafetyScanner` is
  structural validation only (magic bytes, real DOCX shape, active-PDF
  markers) — never claimed as antivirus (`apps/web/src/lib/capabilities.ts`:
  `malwareScanning: 'disabled'`, ADR-0011). Swapping in a real `ScannerPort`
  implementation (e.g. ClamAV) requires no domain change.
- **Full PDF sanitization (CDR).** The active-content check is a marker
  search, not a parse-and-strip. A PDF that fails it is rejected outright
  (fails closed) rather than sanitized and admitted.
- **Generated redacted renditions.** Third-party preview still fails closed
  with 501 (`/api/blob/[key]`) until a real rendition pipeline exists
  (Milestone 2 scope, pre-dates this PR) — never falls through to original
  bytes.
- **Explicit per-call parser timeouts.** `unpdf`/`mammoth` invocations rely
  on the deployment platform's own function-timeout as the outer bound, not
  an in-process timer. The realistic zip-bomb/DoS surface for the parsers
  that exist today is covered by the entry-count/size/ratio bounds above;
  add an explicit timeout if a new, slower parser is introduced.
- **Image pixel/dimension limits.** Moot today: no image decoder exists
  anywhere in the pipeline (OCR is explicitly not implemented —
  `text-extraction.ts`), so there is no code path that would ever decode
  image pixel data. Add bounds when an image parser is introduced, not
  before.
- **Password-protected-PDF regression test.** `extractPdf()`
  (`packages/adapters/src/text-extraction.ts`) already classifies a
  password-protected PDF as `password_protected` (matched from `unpdf`'s
  thrown error message) — real, pre-existing behavior — but has no
  fixture-based test: a genuinely encrypted PDF is not something this suite
  hand-crafts (unlike the other fixtures here, correctness would depend on
  `unpdf`/`pdf.js`'s internal exception classification for a real encrypted
  document, not on this codebase's own logic). Add one if a real encrypted
  sample file becomes available to fix as a test asset.

## Verification

`packages/adapters/src/{docx-validation,zip-structure}.test.ts` are the
dedicated structural-validation suites. `packages/adapters/src/adapters.test.ts`
covers the scanner end-to-end (including the two regressions this PR
closes). `packages/services/src/documents.test.ts` covers the serving-
boundary gate. Re-run on every change to `packages/adapters/src/{scanner,
docx-validation,zip-structure}.ts`, `packages/services/src/{documents,
intake}.ts`, or `apps/web/src/app/api/blob/[key]/*`.
