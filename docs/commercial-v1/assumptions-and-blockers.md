# Commercial V1 Assumptions and Blockers

## Blocker 1: governing PRD file (RESOLVED)

Part 1 Section 1 of the governing directive (`docs/roadmap/commercial-v1-implementation-directive.md`)
names `docs/product/commercial-v1-prd-2026-09-16.md` as the single authoritative
product specification, pinned to a SHA-256 hash, with an explicit instruction to
stop and report rather than reconstruct or paraphrase the PRD from memory if it
is missing or the hash does not match.

The file was initially not present in the repository (confirmed by direct path
check, full-repository text search for the filename, and a search for the hash
prefix; all found nothing). This was reported to the product owner as a stop
condition rather than proceeding on a guess.

The product owner then supplied the file directly. Its SHA-256, computed with
`sha256sum`, is `5eeb15438799d89db9122ff050f15d96139f8e94d373e3b5ba9ea406a1c21575`,
an exact character-for-character match to the hash pinned in Part 1 Section 1.
Correction to the record: an earlier draft of this file claimed that pinned
hash string was 65 hex characters and therefore could not be a valid SHA-256
digest. That was a manual miscounting error made while eyeballing the string in
the directive text, not a property of the actual hash; `sha256sum`'s own output
is (as it must always be) exactly 64 hex characters, and it matches. Retracted.

The PRD is committed at `docs/product/commercial-v1-prd-2026-09-16.md`. Part 1
proceeds on it as the authoritative specification, per the directive's own
authority order (Section 1): explicit user instruction, then this PRD, then
approved implementation decisions, then retained architecture/security
invariants, then older PRDs as historical context only.

## Decision: how "push to production" is being interpreted

The instruction to commit, push, and reach production within three minutes of
each key chunk is noted, and conflicts directly with the governing directive's
own rules: Part 1 Section 3 ("Do not merge anything to main. Do not deploy
production.") and Part 10 Section 17 ("DO NOT merge to main; merge/close PR
#77; deploy real production ... unless explicitly instructed by the user after
reviewing the final report"). The PRD itself reinforces this independently:
Section 22 item 9 says not to "set readiness attestations, claim commercial
operation or merge/deploy beyond the actual authorisation," and the whole
document's release-gate design (Section 19) treats commercial admission as
something that requires accumulated verified evidence across all P0
requirements, not a per-chunk action. It also sits outside this session's own
operating rules for this repository, which designate
`claude/lucid-lamport-70jivu` as the branch to develop on and call for a draft
pull request, not a direct production deploy.

Resolution being applied: "push to production" is being treated as push to the
working branch and keep one draft PR continuously current, on the same cadence
(after each meaningful chunk), so the PR's own CI is the fast feedback loop
standing in for a production push. Actual merge to `main` and any real
production deployment or commercial-mode activation waits for explicit
sign-off after review, exactly as the directive and the PRD both require. This
is a deliberate deviation from the literal chat instruction, made because
every governing document this session was asked to implement forbids the
literal instruction, and because this product handles passport and financial
data where an unreviewed autopush to production is a real risk. Flagging it
here rather than silently picking a side.
