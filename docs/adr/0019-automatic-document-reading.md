# ADR-0019: Automatic document reading (one pipeline, cheapest reader first)

- **Status:** Accepted (architecture freeze, 26 Oct 2026); implementation pending (Sonnet packages S5 and S6 in `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md`)
- **Date:** 2026-10-26
- **Deciders:** Owner (26 Oct 2026 programme instruction: reading must be automatic, cheapest reader first, AI proposal-only); architecture session
- **PRD/Spec link:** ADR 0010 (document pipeline and AI gateway ports), ADR 0011, ADR 0012; `docs/roadmap/SMALL-COMMERCIAL-V1.md`

## Context

Verified on main `174ae1a`:

- Upload enqueues a durable intake job (`processing_jobs`) and triggers the worker. Intake runs QUARANTINED, SCANNING, NORMALIZING, EXTRACTING, then always ends in AWAITING_REVIEW (or NEEDS_ATTENTION for unsafe or oversized files) (`packages/services/src/intake.ts`).
- EXTRACTING runs deterministic text extraction (PDF and DOCX text) and MRZ parsing. Text lands in `extraction_runs.extracted_text`; "no text" is a FAILED row with `empty_content` or `unsupported_format`.
- MRZ (`mrz.ts`) parses the passport's machine-readable lines, but the result only fills `documents.issuer`, `documents.expiresAt` and the file-name suggestion. It creates **no field suggestions**, so a passport upload never offers name, number, date of birth or nationality.
- Private OCR (Tesseract, `packages/adapters/src/ocr-extraction.ts`) runs **only inside the GitHub scanner worker** (`document-intake.yml`), which is used only when `MALWARE_SCANNER_PROVIDER=github_clamav`. That worker is not accepted yet. On the normal Vercel path a photo or scanned PDF gets no text at all.
- AI OCR (`runOcr`, OpenAI/Anthropic/Gemini adapters) and AI field extraction (`runExtraction`) work, with consent (`AI_OCR`, `AI_EXTRACTION`), budgets, caps, a kill switch, a fallback provider, data-terms records and proposals that a person approves. Both are **manual**: the person presses "Read Text from This Scan", then "Read Details from This Document". **AI OCR text is never fed to AI extraction** (`getLatestExtractedText` reads only `extraction_runs`).
- Neither AI entry point checks that the document version belongs to the applicant named in the request. Today only the applicant's ownership is checked.

## Decision

1. **One pipeline, no second architecture.** Reading stays inside the existing intake job and the existing AI services. New work only orchestrates them.
2. **Reader order (cheapest and most private first):**
   1. Deterministic: embedded text plus MRZ. MRZ results become **field suggestions** with no AI and no AI consent. They are recorded through the existing suggestion tables as a zero-cost run whose model version starts `deterministic:` (for example `deterministic:mrz-td3/1`). `field_proposals.ai_extraction_run_id` is NOT NULL, so this avoids a migration. Cost and AI-usage reports exclude `deterministic:` runs, and the screen names the source "Read from the passport's machine-readable lines".
   2. Private OCR (Tesseract) wherever the private worker runs. It is part of the same worker that does the real malware scan, so accepting that worker (commercial-minimum M06) also turns on private OCR. Tesseract is **not** added to the Vercel function (the binary size and cold-start cost are not worth it at this scale; see the deferred register).
   3. AI OCR, only when steps 1 and 2 produced no usable text, the file is an image or a scanned PDF, `AI_OCR` consent is on, AI dispatch is allowed (kill switch, budget, active provider) and the document type is not restricted by the document protection switches.
   4. AI field extraction over the best text available (deterministic, private OCR or AI OCR, in that order), only with `AI_EXTRACTION` consent and the same dispatch checks.
3. **Automatic, not on a button.** When intake reaches AWAITING_REVIEW, it enqueues one `ai-reading` job in `processing_jobs` (idempotency key = document version id plus a reader version) when any AI step could run. The job runs under a new `SystemScope<'process-ai-reading'>`, never under a caller-supplied account id. It derives the acting owner from `document_versions → documents → applicants.owner_account_id` and checks consent for **that** owner. The same existing caps, cache keys and budget locks apply. The buttons stay as "Read Again" (manual retry), not as the normal path.
4. **OCR text feeds extraction.** `getLatestExtractedText` (or a new gated equivalent) returns the newest successful text from `extraction_runs` (deterministic or private OCR) and, failing that, from `ocr_runs`, labelled with its source so a suggestion records where its text came from.
5. **Binding fix (commercial-minimum).** Every AI reading entry point (`runExtraction`, `runOcr`, `runInconsistencyCheck`, `renderOcrSourceImage`, `getLatestExtractedText`) must prove the document version belongs to the applicant (join version → document → applicant, as `suggestDocumentKind` already does) or take a `requireAccess` proof on the document. The access ratchet adds `document_version_id` to its owned-column list so this class of read is caught from now on.
6. **AI stays proposal-only.** Nothing writes a fact without a person's approval. MRZ suggestions with valid check digits may be shown as "Clear details" for the existing bulk accept, still requiring one confirmation. Nothing overwrites a confirmed fact; a different value raises the existing conflict flow.
7. **Without AI consent** the person still gets MRZ and private-OCR suggestions. The documents page shows one plain offer ("Want VisaStack to read your documents for you? Turn On Reading With AI"), linking to the existing consent switch. It never nags per document.

## User-visible states (plain words, Title Case on names)

| Internal | Shown |
|---|---|
| QUARANTINED, SCANNING, NORMALIZING | Checking the File |
| EXTRACTING or an `ai-reading` job pending | Reading the File |
| AWAITING_REVIEW with pending suggestions | We Found These Details (list, Confirm / Change / Skip) |
| AWAITING_REVIEW, nothing found | We Could Not Read This One. Add the Details Yourself. (manual form; Read Again if AI is available) |
| NEEDS_ATTENTION | Needs Attention (existing reasons) |

## Consequences

- **Positive:** passports give useful suggestions with no AI cost or external exposure. Scans get read automatically once the worker is accepted or AI consent is on. One review screen serves every source. The cross-applicant gap in the AI reading entry points closes.
- **Negative:** private OCR depends on the GitHub worker (minutes of delay per batch, Actions minutes if the repository goes private). AI reading adds external calls after upload without a click, but only under the owner's existing consent and budget controls.
- **Follow-ups:** S5 (orchestration, binding fix, MRZ suggestions, OCR text to extraction) and S6 (screen states and copy). A dedicated reading worker or a small always-on clamd/OCR host when the queue trigger in the deferred register fires.

## Alternatives considered

- **Tesseract.js in the Vercel function.** Rejected for now: large WASM and language data, slow cold starts, memory pressure, for a load the worker already covers.
- **Always call AI first.** Rejected: higher cost and exposure, and the owner's order is deterministic, then private, then AI.
- **A new "document intelligence" service.** Rejected: it would duplicate intake, the AI gateway, budgets and review.
