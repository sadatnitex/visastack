# Trust rules: seven promises, checked by tests

In plain words: seven promises VisaStack makes about a traveller's documents and details are now checked automatically, using the real product code and a throwaway test database, so a future change that quietly breaks one of them turns a test red.
Each rule was proven able to fail: we broke the real code on purpose, watched the test go red, and put the code back.

Two things need the owner's decision (see "Findings" below): the central access check answers a stranger differently for a traveller that exists and one that does not (three existing actions pass that difference on to the screen), and an accepted answer to a detail request points at the detail, not at the value that was accepted.

## The rules

| # | Promise | Where it is checked |
|---|---------|---------------------|
| 1 | Ended access never gives a fresh read. After the traveller revokes the grant, the grant expires, the agency member is removed, or the agency is suspended, a waiting copy and an accepted copy both give no download link, no storage call, no listing for the agency, and a link made earlier is refused. | `trust-rules.test.ts`, "Rule 1" (4 tests, one per way access can end) |
| 2 | An accepted receipt always names the same exact copy. A newer version, a rename, a replacement document and another request answered with the newer version leave the saved copy byte for byte the same; the agency still sees version 1 and its fingerprint as accepted; a download is served from the pinned file only. | "Rule 2" |
| 3 | An unrelated party cannot tell whether a record exists. A real request or copy of another agency and a made-up id get the same answer (code and message) from review, decision, withdrawal, listing and download, and no storage call happens. Same for a second traveller who is not the owner. Open gap: the central gate itself, see Findings | "Rule 3" (3 tests) and the two FINDING tests (expected failures) |
| 4 | Nothing is shared without the traveller confirming it. An agency asking, a newer version or another matching document sends nothing; only the owner's own send creates a copy. The agency admin, an unrelated account and a second traveller cannot create one. | "Rule 4" (2 tests) |
| 5 | Earlier declarations and accepted copies stay readable and unchanged: earlier document versions and accepted copies, earlier saved versions of a profile detail (still in the owner's history), and consent records (withdrawing and granting again only adds rows). | "Rule 5" (3 tests) |
| 6 | Retrying never duplicates. The same send with the same key twice gives one copy, one notice per admin and channel, one audit entry. Deciding twice gives one decision. Two sends racing, or two decisions racing, give exactly one winner. | "Rule 6" (3 tests) |
| 7 | AI output never becomes a confirmed fact without a person approving it. A waiting suggestion from a connected AI app changes no fact, does not show in the profile and cannot answer a detail request; after a rejection nothing changes; only the owner's approval saves it, recorded as the person's own word with the AI app named as its origin. | "Rule 7" (2 tests) |

Randomized sequences (`trust-sequences.test.ts`): 12 fixed seeds, 40 random steps each, on one database with one traveller and two agencies that both start with a grant, plus an unrelated agency that probes. Steps: an agency asks; the traveller answers one request (sometimes naming an exact older version); the traveller answers everything one agency waits for in one confirmation (Answer From Your Records), then repeats that confirmation; the traveller uploads a newer version or a replacement; an agency accepts or sends back; the traveller revokes a grant; shares again; the last send is retried with the same key; the unrelated agency probes. After every step it checks: submissions equal successful owner sends; every copy ever sent is byte-identical to how it was first seen; for an agency whose grant ended, every download on every one of its copies is refused with no storage call and an earlier link is refused; an allowed download names the pinned version's own file; the unrelated agency gets the same answer for a real and a made-up id. A failure prints the seed and the numbered steps so it can be replayed.

Seeds: 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233. Steps per seed: 40.

## Findings (honest tests, not bent to pass)

1. The access gate answers differently. `requireAccess` for a stranger on a real traveller returns `forbidden` "access denied (default_deny)"; for a made-up id it returns `not_found` "record not found". This is the gate's own documented contract: callers are meant to give one answer before anything reaches a screen. Every evidence entry point in rule 3 does. An audit of all 99 places where the screens call the gate (12 Nov 2026) found that almost all collapse the two into one answer, and three do not, so a signed-in stranger who already holds a traveller's internal id (a long random value that is never shown to other people) could tell that the record exists:
   - `apps/web/src/app/app/applicant/[id]/section-actions.ts`, `markNotCurrentAction` and `markEndedAction`: a denied record says "Only the profile owner can change this.", a missing one says "This detail is no longer here. Reload the page."
   - `apps/web/src/app/app/applicant/[id]/actions.ts`, the automatic document-kind suggestion: the raw refusal text is shown ("Access denied (default_deny)." or "Record not found."), only when an AI reader is configured.

   Nothing built in this run depends on those paths: the new screens check ownership first and answer "not found" for everyone else. The two gate tests in `describe('FINDING: the access gate ...')` are written with `it.fails`, so the gap is recorded in every run and the tests turn red on purpose when the gate gives one answer. Fixing the three actions, or the gate itself, changes existing access behaviour (and one of the files belongs to another open pull request), so it is listed for the owner's decision and not merged here. Not checked: response timing, and services that make their own access checks outside the gate.
2. An accepted detail answer follows the detail. Probe `probe: an accepted detail answer after the fact changes`: a field request was answered with the phone fact and accepted; the traveller then changed the phone. The request record keeps only `responding_fact_id`, the id of the detail (not of the saved version), and the decision record keeps the same id. Following it now gives the new value (+8801700000222), not the value that was accepted (+8801700000111). The test states what a traveller would expect and is written with `it.fails` (vitest 4 supports it): it counts as an expected failure, so the suite stays green while the gap is open, and it turns red on purpose the day the record starts pinning the accepted value; remove `.fails` then. Documents do not have this gap: a copy sent in answer to a document request pins the exact version, object and checksum.

## Failure proofs

For each rule, one small realistic break was made in the real code, the rule's test was run and went red, and the file was restored byte for byte from a backup.

| Rule | Test | File and the exact line broken | Failing assertion |
|------|------|--------------------------------|-------------------|
| 1 | `Rule 1 ... when the traveller revokes the grant / the grant expires / the agency is suspended` (3 of 4 go red) | `packages/services/src/evidence-submissions.ts`, `audienceOf`: the `orgGrantPermits` grant check made unreachable (`false &&`) | `download 0 must be refused: expected false to be true` |
| 2 | `Rule 2 ... stays byte-identical ...` | `packages/services/src/agency.ts`, `chooseSendVersion`: always take the newest version, ignoring the version the traveller named | `expected { ...(15) } to match object { ...(2) }` (older pin became the newest) |
| 3 | `Rule 3` tests for the unrelated agency and the second traveller | `packages/services/src/agency.ts`, `loadEvidenceRequestForOrg`: `forbidden` returned instead of `not_found` for a non-admin | `expected { ok: false, error: { ...(2) } } to deeply equal { ok: false, error: { ...(2) } }` |
| 4 | `Rule 4 ... only the owner can send ...` | `packages/services/src/agency.ts`, `loadEvidenceRequestForOwner`: the owner comparison removed, so any account may send | `expected false to be true` (a non-owner send was refused no longer) |
| 5 | `Rule 5 ... consent: withdrawing and granting again only adds rows ...` | `packages/services/src/consent.ts`, `setConsent`: earlier consent rows deleted before the new row is written | `expected [ ...(2) ] to have a length of 4 but got 2` |
| 6 | `Rule 6 ... same retry key twice ...` | `packages/services/src/agency.ts`, `submitEvidenceResponse`: the retry-key lookup disabled (`false &&`) | `expected false to be true` (the repeat is no longer answered as a replay) |
| 7 | `Rule 7 ...` (both tests go red) | `packages/services/src/ai-suggestions.ts`, `recordProfileSuggestion`: also saves the suggested value as a fact right away | `expected 2 to be 1` (a fact version appeared without approval) and `expected { ...(10) } to be undefined` |

## Timings (local, one machine)

| File | Tests | Wall time |
|------|-------|-----------|
| `trust-rules.test.ts` | 21 (18 pass, 3 expected failures that record the two findings) | about 35 s |
| `trust-sequences.test.ts` | 13 (12 seeds plus one check that the seeds did real work) | about 55 s |

The sequences file is well under the four-minute budget; every database-building test has an explicit timeout (60 s, and 180 s per seed).

## Files

- `packages/services/src/trust-rules/trust-rules.test-support.ts`: shared set-up (synthetic people and agencies, notice and audit counts, the AI app connection, the seeded generator). It reuses the helpers of `evidence-submissions.test-support.ts` and copies none.
- `packages/services/src/trust-rules/trust-rules.test.ts`: the seven rules, the findings and the probe.
- `packages/services/src/trust-rules/trust-sequences.test.ts`: the randomized sequences.
