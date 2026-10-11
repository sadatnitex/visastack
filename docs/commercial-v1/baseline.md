# Commercial V1 — Baseline (Part 1)

Governing directive: `docs/roadmap/commercial-v1-implementation-directive.md` (archived
verbatim, 4,729 lines, received 2026-09-16).

## Governing PRD (Part 1 Section 1)

File: `docs/product/commercial-v1-prd-2026-09-16.md`.

Initially absent from the repository; reported as a stop condition rather than reconstructed
from memory. The product owner then supplied the file directly. Its SHA-256 is
`5eeb15438799d89db9122ff050f15d96139f8e94d373e3b5ba9ea406a1c21575`, an exact match to the
hash pinned in the directive. Full detail and the retraction of an earlier miscounting error
about the hash length are in `assumptions-and-blockers.md`, Blocker 1 (resolved).

`docs/product/prd-v1.1.md` and `docs/product/build-spec-v1.1.md` are confirmed by the product
owner to be historical files from a prior build phase, not a current parallel specification.
See `supersession-map.md`.

## Repository baseline (Part 1 Section 2)

- Repository: `sadatnitex/visastack`, default branch `main` — both confirmed.
- `origin/main` full SHA: `2cb47e0ac91e8ce323956aff607bae9cd343e5a0`, an exact match to both
  the directive's expected audited commit and the PRD's own "Reviewed commit" (PRD §2).
- main has not moved; no divergence report needed.
- Working branch: `claude/lucid-lamport-70jivu`, at the same commit at start, working tree
  clean.

## PR #77 (Part 1 Sections 2 and 4)

- Number 77, state open, draft true.
- Base: `main` @ `2cb47e0ac91e8ce323956aff607bae9cd343e5a0` (exact match).
- Head: `claude/workos-staging-e2e-second-identity` @
  `fb535c7a4a66143774738640d1c93a891864b0dc` (exact match).
- Changed files: exactly 2 — `.github/workflows/workos-staging-e2e.yml` and
  `docs/roadmap/remaining-commercial-blockers.md` (exact match).
- Disposition: left open and untouched. Its content (WorkOS staging second-identity CI
  wiring, corrected blocker documentation) is valid and not duplicated on this branch. This
  session did not merge or close it, per the directive (Part 1 Section 3, Part 10 Section 17)
  and the PRD (§2: "the PR is not merged and cannot count as main-branch delivery. Inspect and
  reconcile it before duplicating work" — done here, nothing duplicated). Its two files will
  be incorporated when this programme reaches the 8 cross-account E2E tests (directive Part 10
  Section 2; PRD §19's "eight existing skipped cross-account cases must be implemented and
  executed"). Recommend the product owner review and merge PR #77 independently in the
  meantime; it does not need to be held hostage to this programme.

## Prior programme context

Full detail in `supersession-map.md`. Summary: this repository already completed one full
build-and-recovery programme (PRs up to #53) and a post-programme defect-closure engagement
(PR-A through PR-F1, PRs #58-#76, all merged, closing 36 GitHub review findings, 4
baseline-discovered defects, and 18 Codex findings per
`docs/audits/post-programme-defect-register.md`). `docs/roadmap/remaining-commercial-blockers.md`
and `apps/web/src/lib/commercial-readiness.ts` (19 live gates) are the current, authoritative
record of what remains. This session independently re-confirmed several of those items by
reading the actual code; see `known-issues.md`.

## Baseline file inventory (Part 1 Section 5)

All read this session: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, root `package.json`,
`apps/web/package.json`, `apps/web/src/lib/commercial-readiness.ts`,
`apps/web/src/lib/step-up.ts`, `apps/web/src/lib/ai.ts`, `docs/governance/integration-and-
cleanup-directive.md`, `docs/roadmap/remaining-commercial-blockers.md`,
`docs/operations/recovery.md`, plus the PRD Section 23 source-register files:
`packages/services/src/profile.ts`, `packages/services/src/missions.ts`,
`packages/services/src/agency.ts`, `packages/adapters/src/openai-extraction.ts`,
`packages/adapters/src/email.ts`.

Confirmed present but not yet read in depth: `pnpm-workspace.yaml`, `.env.example`,
`packages/db/src/schema.ts` (1,362 lines), `apps/web/e2e/authenticated-workspace.spec.ts`
(564 lines), `packages/policy`, `packages/adapters` beyond the two files above. Deep,
field-by-field audit of these is deferred to the parts that actually implement against them
(mainly Part 2 for schema/policy, Part 3 for the rest of adapters, Part 10 for the E2E spec),
consistent with Part 1's purpose being baseline and ledger, not full implementation.

## Capability inventory (Part 1 Section 10)

See `requirements-ledger.md` for the full, per-requirement table with evidence. Summary of
the specific claims Part 1 Section 10 asks to verify, all independently re-confirmed by
reading the actual code this session (not just repeated from prior documentation):

| Claim | Verified against | Result |
|---|---|---|
| Scanner hardcoded readiness false | `apps/web/src/lib/commercial-readiness.ts` | Confirmed: `realMalwareScanner` gate is a literal `satisfied: false`. |
| NullEmailPort | `packages/adapters/src/email.ts` | Confirmed: `send()` only `console.warn`s, never sends. |
| AI OpenAI-only wiring | `apps/web/src/lib/ai.ts`, `packages/adapters/src/openai-extraction.ts` | Confirmed: `createAiExtractor` rejects any provider other than `'openai'`; only one adapter class exists. |
| Approximate blended AI cost calculation | `apps/web/src/lib/ai.ts` | Confirmed: single `APPROX_USD_PER_MILLION_TOKENS = 10` constant across all models, documented in its own comment as not a billing source of truth. |
| Snapshot over-collection | `packages/services/src/missions.ts`, `snapshotMission` | Confirmed: loads every fact/document for the whole applicant, not the mission's selected evidence. |
| Missing applicant acknowledgement | `packages/services/src/missions.ts` | Confirmed: no acknowledgement entity or function found. |
| Note visibility/org ownership | `packages/services/src/agency.ts`, `addNote`/`listNotes` | Confirmed: no visibility field, no author-organisation ID on mission notes. |
| Task due dates | `packages/services/src/missions.ts`, `createTask` | Confirmed: `missionTasks` has no due date, timezone, or priority fields. |
| Profile plaintext sensitive values | `packages/services/src/profile.ts`, `editFact` | Confirmed: writes `value: string` directly with no sensitivity-based protection. |
| Rule applicability/freshness | `packages/services/src/missions.ts`, `computeReadiness` | Partially confirmed: result model is boolean `satisfied` only, not the PRD's richer per-requirement state enum; freshness/source metadata not yet located at this call site. |
| Commercial controls | not yet located | No plan/entitlement/billing schema found in files read this session; likely NEW. |
| Cross-account E2E gaps | `docs/roadmap/remaining-commercial-blockers.md` §3 (not independently re-read this session, PRD §2 corroborates: "eight unconditional skipped placeholders without journey steps") | Reported, consistent across two independent sources. |
| Recovery assumptions | `docs/operations/recovery.md` vs PRD §17 | Confirmed inconsistent: the doc's RPO ≤5min/RTO ≤60min targets are explicitly superseded by the PRD's single stricter-but-more-conservative RPO ≤15min/RTO ≤4h V1 target; needs reconciliation. |

## Verification run (Part 1 Section 9)

First run (before this session's dependency fix), commit `2cb47e0ac91e8ce323956aff607bae9cd343e5a0`:

| Check | Command | Result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | PASS |
| Lint | `pnpm run lint` | PASS (Biome, 288 files, no issues) |
| Typecheck | `pnpm run typecheck` | PASS |
| Test | `pnpm run test` | PASS (26 test files, 338 tests, all passed, `@visastack/services` package; full monorepo turbo run reported 7/7 tasks successful) |
| Build | `pnpm run build` | PASS |
| Dependency audit (`pnpm audit --prod`) | `pnpm audit --prod` | **FAIL**: 13 vulnerabilities (2 critical, 9 high, 2 moderate). See below. |

The audit failure contradicts `docs/roadmap/remaining-commercial-blockers.md`'s claim that
`pnpm audit --prod` was clean as of PR-F1. Either new advisories were published since that
engagement closed, or something regressed; this session did not investigate which, since the
fix is the same either way. Findings:

- **Critical** (2): Next.js unauthenticated RCE on Windows-hosted servers
  ([GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36)) and Next.js
  unauthenticated RCE in the Image Optimization API via AVIF files
  ([GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)), both fixed in
  `next` >=15.5.24. Resolved version was 15.5.21 (`apps/web/package.json` pinned `^15.5.21`).
- **High** (8): seven `@xmldom/xmldom` issues (element/attribute/processing-instruction/
  doctype injection, ReDoS, quadratic-time/memory parsing) via `packages/adapters > mammoth >
  @xmldom/xmldom`, resolved version 0.8.13, no override in place, fixed at >=0.8.15; plus one
  `sharp` libheif issue via `apps/web > next > sharp`
  ([GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)), resolved version
  0.35.3, existing `pnpm.overrides` floor of `>=0.35.0` was not high enough (fix needs
  >=0.35.4).
- **Moderate** (2): two more `@xmldom/xmldom` issues, same package/path as above, both fixed
  at >=0.8.15.

Fixed this session, all patch-level bumps within already-adopted major versions (Next.js
stays 15.x; no major-version upgrade, consistent with Part 1 Section 9/directive Section 12):
`apps/web/package.json` `next` bumped `^15.5.21` → `^15.5.24`; root `package.json`
`pnpm.overrides.sharp` bumped `>=0.35.0` → `>=0.35.4`; added `pnpm.overrides["@xmldom/xmldom"]
= ">=0.8.15 <0.9.0"` (previously unoverridden).

The first attempt at the `@xmldom/xmldom` override was unbounded (`">=0.8.15"`), which let
pnpm resolve to `0.9.12` and broke real DOCX text extraction via a breaking API change in
`mammoth`'s dependency — caught by this session's own re-verification before committing, not
left for later. Bounded to `<0.9.0` and re-verified green. Full sequence in
`test-evidence.md`; lesson recorded in `known-issues.md` item 11.

**Final verification, all green:** install, lint, typecheck, test, build, and
`pnpm audit --prod` ("No known vulnerabilities found") all pass with `next@15.5.25`,
`sharp@0.35.4`, `@xmldom/xmldom@0.8.15` resolved. Full per-command detail in
`test-evidence.md`.

## Decisions and interpretation notes

See `assumptions-and-blockers.md` for the full record, including how "push to production"
in the user's instruction is being interpreted given both the directive and the PRD forbid
literal autonomous production deployment.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
