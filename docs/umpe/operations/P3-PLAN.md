# P3 plan: document understanding (Lane A2, branch umpe/p3-document-intelligence)

Base: origin/main 9461ebe (P2 import already merged). Ledger rows: I16, I13, I07, I11.

## 1. Server upload idempotency (I16)
- Client mints an upload id (UUID) per file line and sends it as `X-Upload-Id` on every attempt;
  Try Again and automatic retries reuse it. Send Again (an explicit new copy) mints a new one.
- The folder import derives the id from the traveller plus the file's name, size and date (SHA-256
  shaped as a UUID), so a reload and re-selection of the same folder reuses the same id.
- New table `document_upload_receipts` (unique account + upload id). The upload action claims the
  id before quota is reserved: a completed claim whose document is still present and younger than
  24 hours replays the original answer (same document, nothing stored, no quota spent); a claim in
  progress answers busy (503, Retry-After); a stale claim is checked against the stored object and
  completed or taken over; a failed upload releases its claim so Try Again works.
- The import queue then retries an unknown outcome on its own, with the SAME id (bounded attempts,
  doubling wait), and keeps manual Try Again.

## 2. Original file name (private)
- Sent percent-encoded in `X-File-Name`, sanitized (base name only, no control or direction
  characters, NFC, 180 characters) and stored only on the receipt row. Never in audit metadata,
  never on `documents.original_name`, never read by agency code. Used once, in intake, to propose
  a readable name when the reader could not name the type (a proposal, never a saved name).

## 3. Document relations (I13)
- New table `document_relation_proposals`, one per new version. Computed in intake after the
  deterministic reading, from deterministic signals only: SHA-256, document type, passport machine
  lines (holder, number, expiry), statement period and account ending read from the text.
- Relations: EXACT_DUPLICATE, CORRECTED_SCAN, NEW_PERIOD, RENEWED. Stored PENDING; the traveller
  confirms or keeps separate. Confirming a corrected scan or renewal marks the older one as the
  Earlier Copy through the existing supersede path; nothing is merged or deleted, ever.
- Labels: Current Copy, Earlier Copy, Same as an Existing Copy, New Period, Renewed.

## 4. Exception-only review (I07, I11)
- `listDocumentExceptions(proof)`: one list per person of files needing one decision (type not
  known, low confidence, proposed relation, possible duplicate). Routine files do not appear.
- New `Needs One Decision` section on the documents page with Confirm / Keep Separate.

## Safety
- New readers and writers take the access gate proof; intake's writer is module-private.
- Code tolerates both tables missing (to_regclass presence check); migration is the last commit.
- Gap: assigning a file to another person or an unassigned staging area (owner design needed).
