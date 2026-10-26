# ADR-0018: Visible reference codes

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Owner (approved the format, the four record types and migration 0091 on 2026-10-26); WP-REF implementation
- **PRD/Spec link:** `docs/upgrades/programme/WP-REF-PLAN.md`; `docs/SESSION-START.md` section 6

## Context

People quote records to each other: a traveller tells an agency which case they mean, an agency names the request it sent, support asks which document is wrong. Until now the only identifiers were internal UUIDs, which nobody can read aloud, and titles, which repeat ("Japan trip"). The owner asked for one standard, short, typo-proof code per record people see, that never changes and is never reused.

Constraints:

- Internal ids, links and calendar UIDs stay exactly as they are; a code is a second, human name.
- The format is permanent once codes are printed, emailed or written down, so it is decided once here.
- Production deploys before its migration runs (`db-migrate.yml` runs from main after the merge), so the code must work while the new table is missing.
- A code must reveal nothing: not who the record belongs to, not how many records exist, not whether a code someone guessed exists.

## Decision

1. **Types.** `P` person (applicants), `C` case (missions), `D` document, `R` agency evidence request. Invoices keep their own `invoice_ref`. Organizations and grants are not quoted by people; a new type later is a new letter in `REFERENCE_KINDS` and the `reference_kind` enum.
2. **Format.** Shown as `C-7K2Q9M`: the type letter, a hyphen, then 5 random characters and 1 check character from Crockford's base32 alphabet `0-9 A-H J K M N P-T V-Z` (no I, L, O or U). Stored without the letter and hyphen. 32^5 (about 33.5 million) codes per type.
3. **Check character.** Damm over GF(32) with the polynomial x^5 + x^2 + 1: the step `s' = 2s XOR d` is a totally anti-symmetric quasigroup, so every single wrong character and every swap of two neighbouring characters is caught (proved exhaustively for the step and over a large sample of codes in `packages/core/src/reference-code.test.ts`). The state starts at the type letter's value, so a code typed under the wrong letter fails. The check character is `2s` of the final payload state; a valid code ends in state 0. A plain Luhn mod 32 was rejected because it misses some swaps.
4. **Reading typed codes.** Case does not matter; spaces and hyphens are ignored; O reads as 0, I and L as 1; U is never valid. When the text starts with a type letter and a valid length, that letter decides the type and nothing else is tried (a wrong letter fails instead of landing on another record). Without the letter, the check character decides, because a code is valid under at most one type. A code whose characters are possible but whose check fails is reported as "one character looks wrong", not as "not found".
5. **Never issued.** A code that spells a word on a short denylist (English and romanised Bangla, also through look-alike digits 0=O 1=I 3=E 4=A 5=S 7=T 8=B), a code of one repeated character, or a code starting `00` (kept for examples and fixtures, so a printed example never matches a real record).
6. **One registry table.** `reference_codes (kind, code, entity_id, created_at)`, primary key `(kind, code)`, unique `(kind, entity_id)`, `CHECK code ~ '^[0-9A-HJKMNP-TV-Z]{6,8}$'`. No foreign key and rows are never deleted, so a code is unique per type forever and is never reused, even after its record is erased (a code and a dead id are not personal data). A registry rather than a column per table, because the four tables are read with bare selects in about 117 places and a new column would break those reads between the deploy and the migration.
7. **Room to grow.** When a type fills up, new codes get one more random character with no change to stored codes, the parser or the database check: an assignment that collides 3 times in a row switches its remaining attempts to 6 random characters (at 10% full that happens about once in a thousand assignments), and gives up loudly after 8 attempts.
8. **Assignment.** `assignReferenceCode` runs inside the transaction that creates the record (`createApplicant`, `createMission`, `registerDocument`, `requestEvidence`). It is idempotent per record and retries a collision with a fresh code. While the table is missing it does nothing and the create succeeds; reads (`referenceCodesFor`) return no code and the page shows none (never a placeholder). Presence is checked with `to_regclass` (never raises, so the surrounding transaction is never aborted), and only "present" is remembered per database handle.
9. **Migration 0091.** Creates the enum and table, then backfills every existing person, case, document and request with a temporary plpgsql function that computes the same check character (entropy from `gen_random_uuid()`), retrying on a code clash, and drops the function. A migration test applies 0091 on top of seeded rows and runs every backfilled code through the TypeScript parser, so the SQL and TypeScript forms can never drift apart.
10. **Lookup.** A typed code is resolved only inside the signed-in workspace search, with exactly the same visibility as the search itself: the owner's own person, case, wallet document and request records; in an agency workspace, a case the member may see (per-case sharing exceptions and assignments included), a person through one of those cases (never their profile), and the agency's own request for its administrators on a case or traveller it still sees. Agencies do not look documents up by code. A missing code, a deleted record and a record the person may not see all give the same empty answer. A query that reads as a code spends a separate hourly budget per account (`REFERENCE_LOOKUP`, 60 an hour); a code typed with its letter whose check fails gets "One character in that reference looks wrong" instead of "no match", and a word that only resembles a code (for example "passport") is an ordinary search. There is no public lookup.
11. **Where codes show.** The case page header, the documents page, the traveller's request page, the agency case cards, request rows and dashboard, the account export spreadsheets (a `reference_code` column on people, documents, cases and requests), the agency JSON export (each exported person's `P-` code; that export holds people only), and the calendar event text ("Case reference C-...") only when the person chose to show case names, so generic titles stay generic. The UID never changes.
12. **Privacy.** Audit metadata never carries a code. Exports include codes only for records already in them. A follow-up message to a traveller may carry a request code only as a structured field the builder formats after a successful parse; free-text checks are unchanged and a code never joins a note. Erasure keeps the registry row (a code and a dead id are not personal data), so a code is never reused.

## Consequences

- Every new person, case, document and request gets a code at creation; older ones get theirs when migration 0091 runs.
- The format cannot change for codes already given. Lengthening is automatic and backward compatible; a new type is additive.
- One extra small insert per create, and one extra query per list that shows codes.
- Codes are not secrets: knowing one gives no access. Access is decided by the same rules as before.

## Alternatives considered

- **A code column on each table.** Rejected: breaks bare selects between deploy and migration, and scatters the uniqueness rule.
- **Sequential numbers.** Rejected: they reveal how many records exist and invite guessing neighbours.
- **Luhn mod N.** Rejected: misses some neighbour swaps; Damm catches all of them.
- **Longer random codes without a check character.** Rejected: harder to read aloud, and a typo would quietly fail as "not found".
