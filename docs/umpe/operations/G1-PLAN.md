# G1 plan: intake gap closure (ledger I07, I08, I09, I10, I14)

Branch `umpe/g1-intake` from origin/main 44d38213. Leases: documents.ts, intake.ts, uploads.ts,
ai-reading.ts (classifier call), umpe-document-*.ts, documents and import pages and components.

## Verified findings
- I07: `suggestDocumentKind` (ai.ts) needs an owner proof and runs only from the document button.
- I08: the rules name carries only `Expires <date>` for passports; statements get no period.
- I09: `applicantId` is fixed at upload; no holding state exists.
- I10: the import panel's finished state has no link to Needs One Decision or pending details.
- I14: expiry and quality insights are computed only when the Insights page is read.

## Build
1. Schema (one appended block, TEMP migration last): `document_intake_exceptions` (applicant,
   document, version, kind EXPIRED_ON_ARRIVAL or NO_READABLE_TEXT, status, unique version+kind) and
   `document_person_holds` (owner_account_id set null on delete, upload id unique per account,
   private object key, file name capped, safety result, proposal applicant and basis, status
   RECEIVING, HELD, FILING, FILED, DISCARDED, filed document). Code no-ops while either is missing.
2. I14: intake records each exception once per version (onConflictDoNothing) when a file is read:
   no readable text (failed reading or under 20 characters) and expired on arrival (saved or
   check-digit-verified expiry before the upload day). Listed in Needs One Decision with Keep As It Is.
3. I08: statement kinds read with confidence get their period ("March 2026", or "1 Mar 2026 to
   31 Mar 2026") in the proposed name, rules and AI paths; no proposal at all when the person has
   decided a name already (renamed or accepted). approvedName never changes without the person.
4. I07: the background reading job, when the rules give no kind, calls the existing classifier core
   through a SystemScope entry with the same feature gate (system context), consent (CORE_PROCESSING
   and AI_EXTRACTION), budgets, cache and rate limit. The result is a waiting proposal listed as
   Suggested Kind in Needs One Decision. No consent or AI off: no call, the file stays Unknown Type.
5. I09: account-level family batch through `/api/documents/hold` (owner proof of the page's
   person). Bytes stored privately, scanned and limit-checked first, then read; a person is
   proposed only when exactly one of the account's own people matches name and date of birth and no
   other person is a close match. Which Person? in Needs One Decision files the document through
   `requireAccess` MANAGE for the chosen person (quota reserved then, normal intake after). Ambiguous
   stays held. Discard deletes the bytes; stale or orphaned holds are swept by the abandoned
   uploads job.
6. I10: the finished import state links to Needs One Decision and to pending details.

## Tests
AI off: no AI call, file listed Unknown Type; manual title kept; two-person batch files only after
its decision and only with access; two close matches stay held; expired passport raises once.
Guards proven red: the close-match rule and the access check on filing.
