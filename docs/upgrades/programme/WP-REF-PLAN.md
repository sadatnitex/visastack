# Visible reference codes: approved plan (owner approval 26 Oct 2026)

Owner decision: every record people see and quote gets a standard, smart, visible reference code of 6 characters with a type letter, for example `C-7K2Q9M`. Internal UUID keys stay unchanged everywhere; calendar UIDs stay as they are (the code may appear in event text). Migration 0091 is pre-approved to run right after this PR merges. Build it AFTER per-case sharing exceptions merges (its migration is 0090). Side package: create `docs/upgrades/programme/allowlists/WP-REF.txt` (listed below) in the first commit. Line references were taken on main 309625c; re-check them.

## Design

- **Types:** `P` person (applicants, schema.ts ~345), `C` case (missions ~592), `D` document (documents ~792), `R` agency evidence request (evidence_requests ~2578). Invoices keep their existing `invoice_ref`. Organisations and grants are not quoted by people; adding a type later is a new enum value only.
- **One registry table, not a column per table.** Drizzle's bare `select()` and `.returning()` list every schema column, and the four tables have about 117 such reads, so a new column would break those pages between deploy and migration. `reference_codes(kind enum('P','C','D','R'), code text, entity_id uuid, created_at)`, primary key `(kind, code)` (unique per type, forever, never reused: rows are never deleted and have no foreign key), unique `(kind, entity_id)`, `CHECK code ~ '^[0-9A-HJKMNP-TV-Z]{6,8}$'` (room to lengthen later). Stored without the prefix.
- **Format:** Crockford base32 alphabet `0-9 A-H J K M N P-T V-Z` (no I, L, O, U). 5 random payload characters plus 1 check character (exactly 6). Capacity 32^5 = 33.5M per type; up to 8 retries on collision; when a type passes 10% full, switch new codes to 6+1 (the parser and CHECK already accept it). Randomness from `crypto.getRandomValues`.
- **Check character:** Damm over GF(32) with polynomial x^5+x^2+1, operation `s' = 2*s XOR d`, state seeded with the type letter's value (a code typed under the wrong type fails), check = `2*s`, a valid code ends in state 0. Catches every single substitution and every adjacent transposition (prove exhaustively in tests). Luhn mod 32 rejected (misses some transpositions).
- **Input:** uppercase, strip spaces and hyphens, map O to 0 and I/L to 1, reject U.
- **Never generated:** codes containing a word from a short denylist (English and romanised Bangla, after a leetspeak map 0=O 1=I 3=E 4=A 5=S 7=T 8=B), a single repeated character, or a payload starting `00` (reserved for docs and fixtures).

## Migration 0091 (generate after 0090 is on main)

One file: create the enum and table; a temporary plpgsql Damm function for the backfill (entropy from `gen_random_uuid()`); `INSERT ... SELECT` for each table where no code exists, in a `DO` loop retrying on `unique_violation`; drop the function. Precedent for SQL backfills: `0020_wide_doctor_doom.sql:15`, `0024_strong_mother_askani.sql:33`. Rows created between deploy and migration are covered because the backfill runs after them. A migration test copies the migrations with the journal cut at 0090, seeds rows, applies 0091 and checks every row has a code that passes the TypeScript parser (this cross-checks the SQL and TypeScript check characters).

## Services

- `assignReferenceCode(tx, kind, id)` (savepoint, `ON CONFLICT DO NOTHING`, retry on collision, idempotent on entity, returns null when the table is missing so the create never fails), called at `applicants.ts:110`, `missions.ts:214`, `documents.ts:118`, `agency.ts:1502`; bulk `assignReferenceCodes` in `apps/web/preview/world.ts` (83, 113, 345, 457, 610, 648) and `packages/load/src/dataset.ts` (276, 335, 439, 501).
- `referenceCodesFor(db, kind, ids)` returns a Map in one query per list; a missing table gives an empty Map (no code shown, never a placeholder). Move `isMissingRelationError` from `ai-data-terms.ts:163` into `errors.ts` and reuse it.
- `resolveReferenceCode(db, principal, text)` in `packages/services/src/reference-codes.ts`: parse (a bad check character returns `invalid`, "one character looks wrong"), look up, then `requireAccess` (P -> applicantId, C -> missionId, D -> documentId, VIEW_METADATA; R: load the request, then the acting organisation's membership plus `organizationId`, or `requireAccess({applicantId})` for the traveller). Missing, deleted and forbidden all return the same `not_found`.
- Wire lookup into `searchWorkspaceRecords` (`workspace-search.ts:17`, behind the authenticated search route; no public endpoint). Add `REFERENCE_LOOKUP: { limit: 60, windowMs: HOUR_MS }` to `rate-limit.ts:38`.

## Display

Shared `formatReferenceCode` / `parseReferenceCode` in `packages/core/src/reference-code.ts`. Show on: case header (`mission/[id]/page.tsx:593`), document list, the person's record hub, agency console (`console-data.ts` 112 and 185), traveller evidence page, agency JSON export (`agency/[orgId]/export/route.ts:80`), account export CSV (`export-csv.ts:66`), calendar event description ("Case reference C-..."; the UID is untouched). A copy button; tabular figures; characters spaced for reading aloud.

## Privacy

- Follow-up message (`agency/[orgId]/follow-up-message.ts`): allow `R-XXXXXX` only as a structured `requestReference` field the builder formats after a successful parse; free-text checks (`containsUnsafeDetail`) stay unchanged and the code never joins a note.
- Audit metadata may carry `referenceKind`, never the code. Exports include codes only for records already in the export. Erasure keeps the registry row (a code and a dead uuid are not personal data); note it in the retention docs.

## Tests

Core: alphabet and length; exhaustive single substitutions and adjacent transpositions; wrong prefix fails; normalisation; denylist and `00` never generated; chi-square over 100k codes. Services: forced collision and retry limit; all four create paths assign codes; missing-table window (creates succeed, reads empty); lookup as owner, grantee, assigned agency member, stranger, restricted document, deleted record (uniform not_found). Migration test as above. Web: header, exports, calendar description, follow-up message with and without a reference.

## Proposed allowlist `docs/upgrades/programme/allowlists/WP-REF.txt`

```
packages/core/src/reference-code*.ts
packages/core/src/index.ts
packages/db/src/schema.ts
packages/db/src/reference-codes-migration.test.ts
packages/db/migrations/0091_*.sql
packages/db/migrations/meta/0091_snapshot.json
packages/db/migrations/meta/_journal.json
packages/services/src/reference-codes*.ts
packages/services/src/applicants.ts
packages/services/src/missions.ts
packages/services/src/documents.ts
packages/services/src/agency.ts
packages/services/src/errors.ts
packages/services/src/ai-data-terms.ts
packages/services/src/rate-limit.ts
packages/services/src/workspace-search.ts
packages/services/src/workspace-search.test.ts
packages/services/src/export-csv.ts
packages/services/src/index.ts
packages/load/src/dataset.ts
apps/web/preview/world.ts
apps/web/src/lib/ics*.ts
apps/web/src/components/ui/reference-code*.tsx
apps/web/src/components/ui/index.ts
apps/web/src/app/globals.css
apps/web/src/app/app/mission/[id]/page*.tsx
apps/web/src/app/app/applicant/[id]/documents/page*.tsx
apps/web/src/app/app/applicant/[id]/evidence/page.tsx
apps/web/src/app/app/applicant/[id]/record/**
apps/web/src/app/app/agency/[orgId]/console-data*.ts
apps/web/src/app/app/agency/[orgId]/follow-up-message*.ts
apps/web/src/app/app/agency/[orgId]/follow-up-copy*.tsx
apps/web/src/app/app/agency/[orgId]/export/route*.ts
apps/web/src/app/api/workspace/search/route*.ts
docs/adr/**
docs/upgrades/programme/**
docs/commercial-v1/known-issues.md
```

## Order, review, size

Commits: allowlist; core generator and tests; schema, migration and migration test; services (assign, read, resolve, create sites); search and rate limit; web display, ICS and exports; follow-up message; preview and load data. Strict code review plus security review (lookup touches access). Add ADR 0018 for the permanent format. About 1,400 to 1,800 lines including tests. Risks: 0091 must be generated on top of 0090; the SQL and TypeScript check characters must agree (the migration test checks it); backfill subtransactions are slow at large row counts (fine at pilot scale).
