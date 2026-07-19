# Document Intake & Security Pipeline

Authority: Build Spec §6–8, PRD §6–8. Runs on the durable **AWS SQS +
isolated worker** pipeline (Build Spec §15); interactive requests never
block on file/AI work.

## State machine

```
UPLOADING → QUARANTINED → SCANNING → NORMALIZING → EXTRACTING → AWAITING_REVIEW
                                                              → APPROVED
                                                              → NEEDS_ATTENTION
                                                              → FAILED
                                                              → REJECTED
```

## Supported formats (launch)

Camera scan · PDF · DOCX/DOC · JPG/JPEG, PNG, WEBP, HEIC, TIFF · TXT ·
Markdown. Password-protected/corrupt files surface a **recoverable** error.

## Intake

- Server issues a **one-time** upload authorization for an expected
  applicant/document + max size. Client claims are untrusted.
- Upload lands in the **private quarantine** bucket (not previewable/
  downloadable). Record original filename, uploader, source, time, size,
  SHA-256.

## Safety (all before anything reaches clean storage)

Magic-byte/type validation · extension/MIME agreement · size/page/pixel
limits · malware scan · macro/JS/active-content detection · archive-bomb &
decompression limits · corruption/password handling · isolated conversion
for legacy DOC · optional CDR for risky PDF/office files. Only a safe copy
moves to the **clean** bucket.

## Deterministic parsing — runs *before* AI (Build Spec §6)

MRZ / machine-readable zones · embedded PDF text · DOCX text & tables ·
standard dates/amounts/currencies/phones/emails · bank-statement periods &
page metadata · hash/dedup · comparison to existing profile.

## Naming (approval required — Build Spec §7)

Pattern: `Document Type - Primary Subject - Issuer or Context - Relevant Date or Period [ - vN].ext`
AI proposes only; the user approves/edits before it becomes the display
name. Original filename preserved forever; storage key is an immutable UUID.
Uncertain subject/type/date ⇒ **Review required**, never silent inference.

## Failure behavior

- Never show success before the DB transaction commits (no fake progress).
- Retries are **bounded and idempotent**; dead-letter on exhaustion.
- User can retry, replace, download the original (if safe/authorized), or
  complete manually.

## Acceptance gates tied here (Build Spec §19)

Upload-security tests must include: spoofed MIME, malware fixture,
macro/active PDF, corrupt/password file, oversized image, duplicate retry,
and archive bomb — all handled safely and recoverably.
