# Missions, packs, and collaboration boundary map (PR 10)

Written for PR 10 (master directive: `commercial-recovery-completion-ux-directive.md`
§7 "PR 10 — Missions, collaboration and application packs"). Documents what
was found genuinely broken or missing, what this PR closed, and what
remains open — matching the honesty pattern of the other per-PR boundary-map
docs in this directory.

## 1. The flagship bug: repeating facts silently collided

`packages/services/src/missions.ts` computed readiness and built mission
snapshots by loading every current fact and keying them **by field key
alone** (`Map<fieldKey, status>` / `Record<fieldKey, value>`). A repeating
field (`facts.repeatingRecordKey` — e.g. an applicant with two passports,
or two employer entries) can legitimately have **multiple `facts` rows
sharing the same `fieldDefinitionId`**, distinguished only by
`repeatingRecordKey`. Keying by field key alone meant a second instance
silently overwrote the first in both:

- `computeReadiness` — could report a field as CONFLICTED-free (satisfied)
  or CONFLICTED (unsatisfied) based on whichever repeating instance
  happened to be read last, not a coherent answer.
- `snapshotMission` — the immutable snapshot's `facts` object would contain
  only one of the two instances' values, permanently. The other was never
  recorded at all — a silent, irreversible data loss in a supposedly
  immutable capture.

This is exactly what the directive names explicitly: *"Repeating facts must
never overwrite each other in snapshots."*

**Fix:** `loadFactInstancesByKey` and `loadDocumentInstancesByType`
(`missions.ts`) now return every instance as an array per key, never a
single collapsed slot. `snapshotMission`'s `facts`/`documents` are arrays of
individually-identified entries, not key→value objects. A FIELD requirement
is satisfied if **at least one** instance is eligible — the natural reading
for "do we have a usable value on file," since a pack requirement names a
bare field key with no way to target a specific repeating instance.

**Test:** `missions.test.ts` — *"never collides repeating-record instances
in readiness or snapshots"* — two instances (one CONFLICTED, one clean)
under the same field key; asserts readiness is satisfied via the clean one
and the snapshot captures **both** instances distinctly.

**Fixed in PR-D1** (finding #30, post-programme defect register):
`loadDocumentInstancesByType`'s per-key grouping above had a second, later
regression — a document that had never been classified (`docType: null`,
e.g. still awaiting classification, or classification declined) was
silently `continue`d out of the returned map entirely, so it could never
appear in `content.documents` in any future snapshot, even though its
bytes and metadata were never actually lost. Fixed by grouping it under a
sentinel key instead of skipping it. The document's own `docType` field in
the snapshot stays the true, honest `null` — only the map's internal
lookup key changes. **Codex review, PR-D1, round 1:** the sentinel was
originally a plain string (`'__unclassified__'`), reasoned safe because
`classifyDocumentText`'s automatic output is always
ALL_CAPS_WITH_UNDERSCORES — but `docType` is completely free text on both
write sites (`addRequirement`, which only requires non-empty for a
DOCUMENT requirement; `registerDocument`, owner-supplied with no
validation at all), so an admin-authored requirement (or, in principle, a
registered document) could genuinely use that exact string, letting every
unclassified document wrongly satisfy it. Fixed by making the sentinel a
`Symbol` instead — a `string` can never `===` a `symbol` as a `Map` key,
so the group is structurally unreachable from any real requirement's
lookup regardless of what free-text value `docType` takes, without adding
(or having to keep in sync) any validation in `packs.ts` or `documents.ts`.
**Test:**
*"includes an unclassified (no docType) document in a snapshot, ineligible
for any specific-type requirement"* — asserts the document still appears in
`content.documents` with `docType: null`, and that a DOCUMENT-kind
requirement mapping entry correctly shows it as unsatisfied.

## 2. Snapshot freeze-field completeness

Directive requirement: mission snapshots must freeze *"FactVersion IDs,
DocumentVersion IDs, Evidence-link IDs, object hashes, approved display
names, requirement version, readiness result, reviewer decisions,
generated-output versions."*

| Field | Before PR 10 | After PR 10 |
|---|---|---|
| FactVersion IDs | Not captured — only a raw value string | `facts[].factVersionId`, per instance |
| DocumentVersion IDs | Not captured — only the parent `documents.id` | `documents[].documentVersionId` (the specific version, not the document) |
| Evidence-link IDs | Not captured at all | `facts[].evidenceLinkIds` — resolved from `evidenceLinks` per fact version |
| Object hashes | Not captured | `documents[].sha256` |
| Approved display names | ✓ (already present) | ✓ (unchanged) |
| Requirement version | Only `packVersionId` (a bare reference) | `packVersion: { id, version, checksum }` — the checksum inlined, so the snapshot is self-verifying without a live join |
| Readiness result | ✓ (already present) | ✓ (unchanged) |
| Reviewer decisions | Concept didn't exist | Recorded via `mission_decisions` (§4) — **not yet folded into snapshot content itself**, see §7 |
| Generated-output versions | Concept didn't exist | Recorded via `generated_outputs` (§6) — **not yet folded into snapshot content itself**, see §7 |

**Fixed in PR-D1** (finding #29, post-programme defect register): the shape
change above — `content.facts` moving from a plain `Record<fieldKey,
value>` object (pre-PR-10) to the array-of-instances shape this section
describes — was never backfilled onto historical snapshot rows, correctly,
since a snapshot is an immutable point-in-time capture that must never be
rewritten after the fact. But the snapshot *read* path (the mission
snapshot detail page in `apps/web`) assumed the new array shape
unconditionally and crashed on any snapshot taken before PR 10 shipped.
Fixed by extracting the read-side normalization into its own pure module
(`snapshot-facts.ts`, zero Next.js/service imports) that detects both
shapes and synthesizes honestly-labeled placeholder values (`status: 'not
recorded (pre-PR-10 snapshot)'`) for fields the legacy shape never
recorded — never fabricating values that could be mistaken for genuine
provenance. Scoped deliberately narrow: only `content.facts`'s literal
object-vs-array crash is fixed here; `content.documents`'s smaller legacy
field set and `requirementMapping`'s legacy quirks degrade display only,
never throw, and are left untouched.

## 3. Readiness exclusion rules

Directive: *"Readiness must ignore: unsafe documents, expired documents,
unapproved classifications, unselected evidence, conflicted facts, missing
confirmations, revoked evidence access."*

| Rule | Before PR 10 | After PR 10 |
|---|---|---|
| Unsafe documents | **Not checked** — any document with a matching `docType` counted, regardless of `safetyStatus` | `DocumentInstance.eligible` requires `safetyStatus === 'CLEAN'` |
| Expired documents | **Not checked** — `documents.expiresAt` never read | `eligible` also requires `expiresAt` null or in the future. No current code path ever sets `expiresAt` (confirmed by search), so this is a defensive, forward-compatible check rather than a fix to an exploitable gap today |
| Unapproved classifications | Interpreted as: a document must have cleared automated processing to at least `AWAITING_REVIEW` | `eligible` reuses `isServableProcessingState` — the *exact same* canonical definition `documents.ts` already uses to gate preview/download, not a second, divergent one. See §8 for why this interpretation was chosen over gating on `documentClassifications.reviewRequired` |
| Unselected evidence | **Not checked** — a DOCUMENT requirement auto-matched *every* document of the right type | §5 — explicit selection now narrows the eligible set once a selection exists |
| Conflicted facts | ✓ already handled | ✓ unchanged (and now correct for repeating fields — §1) |
| Missing confirmations | **Not checked** — `EXTRACTED_PENDING` counted as satisfying | `isFactStatusEligible` excludes `EXTRACTED_PENDING` (never confirmed), `STALE`, and `SUPERSEDED`, in addition to `CONFLICTED`. `DECLARED` still counts — see §8 for why |
| Revoked evidence access | Not applicable in the current architecture | Missions read `facts`/`documents` scoped directly by `applicantId`, never through a grant — there is no code path today where revoking a grant could leave stale cross-tenant evidence counted in a mission's own readiness. Flagged, not built around, since there's nothing to fix |

**Tests:** `missions.test.ts` — *"does not count an unsafe, still-processing,
or expired document..."* and *"does not count an unconfirmed
(EXTRACTED_PENDING) or STALE fact..."* — each exclusion proven individually
against a real PGlite database, not asserted from reading the code.

## 4. Reviewer decisions

New `mission_decisions` table (append-only, like every other decision-history
table in this schema) plus `recordMissionDecision`/`listMissionDecisions`
(`packages/services/src/agency.ts`).

**Authorization is deliberately stricter than every other mission-write in
this PR:** the mission owner (applicant) **cannot** record a decision on
their own mission — only an org member who is both an *active member* of
the organization and *specifically assigned* to that mission, with the
organization holding a live `MANAGE`-permitting grant (mirroring
`assignMember`'s exact authorization shape). Allowing self-decisions would
collapse "reviewer decision" into self-attestation, defeating the purpose
of the concept. Proven directly: `agency.test.ts` includes a test asserting
the owner is refused, alongside tests for an unassigned-but-genuine org
member and a stranger org with no grant at all.

UI: `apps/web/src/app/app/agency/[orgId]/mission-collaboration.tsx` — a
compact requirement picker + accept/reject form, visible to any org member
with access to the mission's collaboration card, but only submittable by an
assigned member.

## 5. Explicit evidence selection

New `selected_evidence` table plus `selectEvidence`/`unselectEvidence`/
`listSelectedEvidence` (`missions.ts`).

**Design choice — narrows, does not gate:** a DOCUMENT or FIELD requirement
with **no selection yet** falls back to "any eligible instance," exactly
matching this PR's tested pre-existing behavior. Once **any** selection
exists for a requirement, `buildRequirementMapping` restricts that
requirement to *only* the selected instance(s) — other eligible-but-
unselected candidates stop counting, even toward readiness. This was a
deliberate reading of the directive's "ignore unselected evidence": treating
selection as *mandatory before anything can satisfy a requirement* would
have broken every existing single-candidate mission (the overwhelmingly
common case) the moment this PR shipped, for a directive line whose purpose
is precision once there's real ambiguity among multiple candidates — not a
blanket prerequisite. This is a judgment call, documented rather than
silently made.

**Test:** `missions.test.ts` — *"ignores an eligible-but-unselected instance
once a selection narrows the requirement"* — two instances (one clean, one
conflicted); selecting *only* the conflicted one flips readiness from ready
to not-ready even though the clean, unselected instance still exists on
file. Directly proves the exclusion, not just the schema.

**Fixed in PR-D1** (finding #34, post-programme defect register):
`selectEvidence` validated only that the fact/document belonged to the
mission's own applicant — never that its *own* field key/docType actually
matched the *requirement* being satisfied. A crafted or stale request could
therefore attach any of the applicant's own facts/documents to any
unrelated requirement, corrupting `buildRequirementMapping`'s per-requirement
narrowing above, which strictly keys by field key/docType and was never
built to expect a mismatched row. Fixed by joining `facts`→`fieldDefinitions`
(the same join pattern `loadFactInstancesByKey` already uses) and selecting
`docType` from `schema.documents` directly, comparing both against the
requirement's own `fieldKey`/`docType` and refusing the selection
(`serviceError('invalid', ...)`) on a mismatch — safe per `packs.ts`'s own
construction-time guarantee that a FIELD requirement always has a non-null
`fieldKey` and a DOCUMENT requirement always has a non-null `docType`.
**Test:** *"refuses a selection whose fact/document doesn't match the
requirement's own field key/docType, even for the applicant's own data"* —
a mismatched fact and a mismatched document (both genuinely owned by the
applicant) are each refused with `code: 'invalid'`, while the original
correctly-matching selections still succeed (positive control).

UI: a "Select evidence" card on the mission workspace page, shown only when
a requirement actually has more than one candidate (the common
single-candidate case stays uncluttered).

**Fixed in PR-D1** (finding #33, post-programme defect register): the
mission workspace UI's own `selectionIdsByCandidate` lookup (`page.tsx`
building it, `collaboration-panels.tsx` reading it to know which selection
a "remove" click deletes) was keyed by bare fact/document id alone. The
same fact or document can legitimately be an eligible candidate for *more
than one* requirement (e.g. two requirements both accepting the same
document type) — keying by id alone meant the second requirement's
selection row silently overwrote the first's entry, so clicking "remove" on
one requirement's row could delete a *different* requirement's selection.
Fixed with a composite key (`packRequirementId:candidateId`) extracted into
one shared pure function (`composeSelectionCandidateKey`, zero Next.js/
service imports) imported identically by the write site and both read
sites, so the two sides can never independently drift apart in format.

## 6. Grounded letters and translation provenance

New `generated_outputs` table plus `generateCoverLetter`/
`listGeneratedOutputs` (`missions.ts`).

**Deliberately not AI.** A template-based, deterministic generator that
composes a letter strictly from the mission's *current satisfied*
requirement mapping (§5's selection-aware view) — every line traces to one
specific fact value or document name, and `groundedReferences` cites the
exact `FactVersion`/`DocumentVersion` id backing it. Refuses to generate
anything if nothing is satisfied yet, rather than emitting an empty or
templated-but-unfounded letter. Using the AI Gateway here would have pulled
this capability into PR 9's evaluation/benchmark requirements for a
different kind of task than PR 9 scoped (field extraction) — kept separate
and honest about what it is: assembly, not generation.

**Translation provenance is plumbing only.** `generatedOutputs.language`
and `translatedFromOutputId` (a plain uuid, no FK — matching the codebase's
established self-reference pattern, e.g.
`aiExtractionRuns.servedFromCacheRunId`) exist so a future translation
feature has somewhere to record its provenance without a schema migration.
**No translation is actually generated by this PR.** This mirrors the
"field exists, capability doesn't yet" honesty pattern PR 8 used for
`valid_until`.

**Test:** `missions.test.ts` — *"refuses to generate a letter with nothing
grounded yet, then generates one citing exact evidence, versioned"* —
asserts the refusal, then asserts every `groundedReference`'s id resolves to
a real, just-created `FactVersion`/`DocumentVersion`, and that a second
generation increments the version rather than overwriting the first.

## 7. Tasks

New `mission_tasks` table plus `createTask`/`decideTask`/`listTasks`
(`missions.ts`) — a lightweight, optionally requirement-linked checklist
item, owner-scoped. Distinct from the pre-existing `evidenceRequests`
(applicant-facing "give me X," not mission-scoped) and `assignments`
(assigns a whole mission to a member, not a specific unit of work).

## 8. Judgment calls, made explicit

- **"Unapproved classifications" reads as "hasn't cleared automated
  processing," not "the classifier's own confidence flag."** Investigation
  showed `documents.docType` (what readiness actually reads) is set only by
  an explicit caller action at registration time — it is never auto-promoted
  from `documentClassifications.classifiedType`/`reviewRequired` at all
  (confirmed by tracing every write to `documents.docType`). Gating on
  `reviewRequired` would therefore be checking a field disconnected from what
  determines whether a document counts, and could incorrectly exclude
  legitimately human-confirmed documents. The processing-state gate
  (`isServableProcessingState`) is the real, load-bearing "has this been
  through the pipeline" signal already used elsewhere, and is what this PR
  reuses.
- **`DECLARED` fact status still satisfies a requirement.** Only
  `CONFLICTED`, `EXTRACTED_PENDING`, `STALE`, and `SUPERSEDED` are excluded.
  A bare self-declared value is the system's normal default status
  (`fact_versions.status` defaults to `DECLARED`) and is treated as
  legitimate everywhere else in the product; excluding it here would be a
  much larger behavior change than "missing confirmations" asks for.
- **Reviewer decisions and generated-output versions are not yet folded
  into snapshot `content` itself** (§2's table) — they exist as their own
  queryable, auditable tables, but a snapshot taken today does not embed
  "decisions as of this snapshot" or "which letter version existed at
  export time" inline. Left for a follow-up once real usage shows whether
  inlining is actually needed versus joining at read time.
- **"Conflicts" in the directive's PR 10 "Complete:" list** is read as
  already satisfied by the pre-existing fact-versioning `conflicts` table
  (PR 8) plus this PR's readiness exclusion (§3) — no separate
  mission-level conflict-flagging system was built. A reviewer who disagrees
  with selected evidence now has the decision mechanism (§4) to record that
  disagreement instead.
- **"Evidence requests" and "comments"** (directive's "Complete:" list) were
  found already implemented pre-PR-10 (`evidenceRequests`, `missionNotes` —
  PR 2 scope) and were not rebuilt.
