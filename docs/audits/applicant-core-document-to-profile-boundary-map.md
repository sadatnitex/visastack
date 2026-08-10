# Applicant core / document-to-profile boundary map (PR 8)

Written for PR 8 (master directive: `commercial-recovery-completion-ux-directive.md`
§7 "PR 8 — Applicant core and document-to-profile completion"). Documents
what the fact-versioning model actually guarantees today, what this PR
closed, and what's still open — matching the honesty pattern of the other
per-PR boundary-map docs in this directory.

## 1. The fact model

A **fact** (`facts` table) is one field instance for one applicant —
identified by `(applicantId, fieldDefinitionId, repeatingRecordKey)`. Its
value is never stored directly; `facts.currentVersionId` points at a row in
**`fact_versions`**, which is append-only and never updated. Every manual or
AI-approved edit inserts a new version and re-points the fact at it, inside
one transaction with an audit event — nothing overwrites history.

Per directive §7's checklist, a fact version now carries:

| Requirement | Column(s) | State before PR 8 | State after PR 8 |
|---|---|---|---|
| Current value | `value` | ✓ | ✓ (unchanged) |
| Immutable history | append-only `fact_versions` rows | ✓ | ✓ (unchanged) |
| Effective date | `effective_from`, `valid_until` | Columns existed, never written — every version was `NULL` | `effective_from` is set on every edit (`EditFactInput.effectiveFrom`, defaults to `now()`); `valid_until` remains unwritten — see §4 |
| Evidence | `evidence_links` | ✓ | ✓ (unchanged) |
| Last confirmation | `approved_at` | ✓ (set on every edit) | ✓ (unchanged) |
| Sensitivity | `field_definitions.sensitivity` | ✓ | ✓ (unchanged) |
| Status | `fact_versions.status` (`FactStatus`) | ✓ | ✓ (unchanged) |
| Conflict | `status = 'CONFLICTED'` + `conflicts` table | ✓ | ✓ (unchanged) |
| Reason for change | `reason` | ✓ | ✓ (unchanged) |
| Mission use | — | Not tracked at all | `listMissionsUsingField` (packages/services/src/missions.ts) — see §3 |

## 2. Atomic proposal approval — the bug this PR fixed

`approveProposal` (packages/services/src/ai.ts) is how an AI field proposal
becomes a real, trusted profile fact. Before this PR it ran as **two
separate transactions**:

1. `editFact(db, ...)` — its own `db.transaction()`, writing the new fact
   version and re-pointing `facts.currentVersionId`. This committed and
   returned.
2. A second, separate `db.transaction()` that updated `field_proposals.status`
   to `APPROVED`, and conditionally inserted `correction_feedback` and
   `conflicts` rows.

If step 2 failed for any reason (a dropped connection, an out-of-memory
kill, a deploy restarting the process mid-request), step 1's write had
**already committed**. The result: the applicant's profile fact had
genuinely changed, but the proposal that caused it stayed `PENDING` forever
— appearing to the user as an unreviewed proposal even though its value was
already live, with no correction-feedback or conflict record even when one
should exist.

The fix nests `editFact`'s write inside `approveProposal`'s own transaction
(a Postgres SAVEPOINT via Drizzle's transaction-on-a-transaction support) so
the fact-version write and the proposal-decision write commit or roll back
as one unit — matching directive §7's explicit list: "approved document
name, selected profile fact versions, current pointers, evidence links,
proposal decisions, correction feedback, confirmation, audit event... Failure
must roll back everything."

**"Approved document name" is a separate, intentionally-not-merged flow.**
Document naming (`decideDocumentName`, packages/services/src/document-naming.ts)
and field-proposal approval are distinct user-facing review actions on
different screens — a user reviews a proposed filename separately from
reviewing a proposed field value. Each is independently atomic (document
naming's own atomicity predates this PR and is covered by its own test
suite: "propose then decide, atomically"). Merging them into one
cross-feature transaction would be a much larger, riskier change for
marginal benefit — the directive's "must commit together" list is read here
as "everything one approval action touches," not "every kind of approval
across the product is one transaction."

**Test coverage.** `packages/services/src/services.test.ts` adds a direct
test of the underlying mechanism: `editFact` called with an already-open
outer transaction, which then throws — asserting the nested write's fact row
never exists afterward (a real PGlite/Postgres rollback, not a mocked one).
No natural, non-contrived Postgres constraint exists in the second phase's
tables (`field_proposals`, `correction_feedback`, `conflicts` — none carry a
UNIQUE constraint beyond their primary key) to reproduce the exact original
bug end-to-end without mocking, which this codebase's test suite
deliberately avoids everywhere else. The mechanism test proves the same
underlying guarantee `approveProposal` now relies on.

## 3. Mission use

`listMissionsUsingField(db, actorAccountId, applicantId, fieldKey)` reports
which of an applicant's missions currently rely on a given field — defined
as: the mission has an attached, published pack version with a `FIELD`
requirement citing that key. This is a **live** relationship, not tied to a
specific historical fact version: mission readiness always evaluates the
current fact value, so only "does the attached pack still require this
field" is meaningful, regardless of which version of the fact currently
satisfies (or fails to satisfy) it. Authorization mirrors every other
per-applicant read: the caller must own the applicant.

Surfaced on the Fact History page — each field's card shows which missions
use it, linking to each one.

## 4. What this PR does not cover

- **`valid_until`** remains unwritten. The directive's "effective date"
  requirement is satisfied by `effective_from`; `valid_until` would model a
  fact's value expiring on a known date (e.g., a temporary address with a
  planned end date already captured by the `address_to` field within the
  address group) — a genuinely separate feature (explicit fact expiry) than
  what was asked for here, and left for a future PR if a real need emerges.
- **Medical attendant pack** (`medical_attendant`) is a first pass at the
  fields directive §7 names — identity, relationship to patient, passport,
  role, and return-travel plan. It has not been validated against a real
  attendant-visa requirement pack (Pack Studio), since no such pack exists
  in this pilot yet.
- **Backdating UI** is a collapsed, opt-in `<details>` per field
  ("Backdate this entry") rather than a prominent date picker — deliberately
  low-visibility so the common case (today's date, the default) stays a
  one-field, one-click save, matching PR 7's "not overwhelming" principle.
- No migration was needed — `effective_from`/`valid_until` and the
  `medical_attendant` pack value are additive; no existing schema or data
  changed shape.

**Fixed in PR-D2** (finding #25, post-programme defect register): the
"Backdate this entry" `effectiveFrom` value above is written correctly
(`new Date('YYYY-MM-DD')` parses as UTC midnight for that calendar date,
per the ECMAScript spec) but was DISPLAYED via `toLocaleDateString()` with
no explicit `timeZone` — silently re-interpreting that UTC instant in the
*viewer's* own local timezone, so a date entered as `2020-01-15` rendered
as `Jan 14, 2020` for any viewer west of UTC. `apps/web/src/lib/format-date.ts`'s
new `formatDateOnly` closes this by passing `timeZone: 'UTC'` explicitly —
the write→store→read pipeline described above already preserves the
UTC-midnight instant losslessly, so only the display step needed fixing.
Applied only to `effectiveFrom`; `updatedAt` ("Last confirmed") is a
genuine timestamp and correctly keeps local-time rendering unchanged.
