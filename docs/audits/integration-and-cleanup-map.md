# VisaStack — integration and cleanup map

Maintained per
[`docs/governance/integration-and-cleanup-directive.md`](../governance/integration-and-cleanup-directive.md).
The directive asks for this file to be "updated with every PR in the
[commercial-readiness] programme" — in practice it was written once, for
"PR 1" of the *earlier* 11-PR commercial-recovery programme (`#54`–`#64`),
and never touched again for the entire 7-PR post-programme defect-closure
engagement that followed it (PR-A through PR-F1, this document's own §2).
That gap is itself a finding of PR-F1's own inventory pass — recorded here
rather than quietly fixed with no trace, consistent with this whole
programme's disclosure discipline. §1 is kept verbatim as the historical
record it always was; §2 is the current, complete picture.

## 1. PR 1 of the commercial-recovery programme (2026-07-31 — historical, kept verbatim)

One canonical implementation already exists for every concern the directive
lists, confirmed by the Phase 0 code inventory
([`commercial-readiness-recovery-baseline.md`](./commercial-readiness-recovery-baseline.md)
§§5–7). PR 1 does not introduce a second implementation of any of these —
it adds exactly one new concern (deployment mode / capability status) that
did not exist before, and wires two existing narrow checks into it.

| Concern | Canonical implementation | PR 1 action |
|---|---|---|
| Authentication | `@workos-inc/authkit-nextjs` via `middleware.ts` + `apps/web/src/lib/session.ts` | Reuse unchanged |
| Authorization | `packages/policy/src/authorize.ts` (`authorize()`, default-deny) | Reuse unchanged (repairs to specific service-layer callers are PR 2 scope) |
| Consent | `packages/services/src/consent.ts` | Reuse unchanged |
| Storage | `apps/web/src/lib/storage.ts` (`createStorage()`) selecting `VercelPrivateBlobStorage` / `NeonBlobStorage` | **Extend**: its lone `VERCEL_ENV === 'production'` branch is migrated onto the new canonical `getDeploymentMode()` helper instead of re-reading `VERCEL_ENV` directly, so there is one source of truth for "what environment is this" |
| Scanning | `packages/adapters/src/scanner.ts` (`BasicSafetyScanner`) | Reuse unchanged (structural-inspection repairs are PR 3 scope) |
| Jobs | `packages/services/src/jobs.ts` + `apps/web/src/lib/jobs.ts` + `/api/jobs/process-intake` | Reuse unchanged (lease/idempotency repairs are PR 6 scope) |
| AI extraction | `packages/services/src/ai.ts` + `packages/adapters/src/openai-extraction.ts` | Reuse unchanged; capability registry now reports its real on/off state truthfully instead of the fact being invisible outside the code |
| Document naming | `packages/services/src/naming.ts` + `document-naming.ts` | Reuse unchanged |
| Profile facts | `packages/services/src/profile.ts` + `apps/web/src/lib/profile-fields.ts` | Reuse unchanged |
| Sharing | `packages/services/src/sharing.ts` | Reuse unchanged; capability registry reports it `available` (see baseline §12 rationale) — no code change |
| Agency access | `packages/services/src/agency.ts` | **Keep disabled** at the capability-registry layer for `addNote`/`assignMember`/`requestEvidence`/`setMembershipActive` pending PR 2's repair; underlying service code untouched in PR 1 |
| Missions | `packages/services/src/missions.ts` | Reuse unchanged |
| Audit | `packages/services/src/audit.ts` + DB `RULE`-enforced append-only `audit_events` | Reuse unchanged |
| Retention and deletion | `packages/services/src/retention.ts` + `deletion.ts` | Reuse unchanged (external-object-deletion wiring is PR 4 scope) |
| Capability status | *(did not exist — prose only in the roadmap directive)* | **New.** `packages/core/src/deployment-mode.ts` (types) + `apps/web/src/lib/deployment-mode.ts` (env-derived mode) + `apps/web/src/lib/capabilities.ts` (registry) |
| UX status labels | Ad hoc `.badge-*` CSS classes (`globals.css`), used per-page for org/grant/document status | **Extend**: the new pilot banner and capability-unavailable messaging reuse these existing classes rather than introducing a new visual system (full design-system work is PR 7 scope) |

**Duplicate/competing implementations found:** none. **Items removed or
merged this PR:** none (additive only). Two non-code items flagged for
future cleanup (not executed then): `db-migrate.yml`'s red-button history
(§2.4 below — closed), `codeql.yml`/`dependency-review.yml`'s permanent
`skipped` state on a private repo (§2.4 below — confirmed still correct,
not a gap).

## 2. Post-programme defect-closure engagement (PR-A → PR-F1, 2026-08-03 → 2026-08-11)

This engagement is governed by
[`docs/audits/post-programme-defect-register.md`](./post-programme-defect-register.md),
whose §5.2 is the authoritative final tally (58/58 numbered findings
closed). This section is the cleanup-directive's own required artifact —
canonical-implementation-per-concern, current as of PR-F1 — not a
restatement of the findings themselves.

### 2.1 Canonical implementation per concern, current state

| Concern | Canonical implementation | What changed since §1 |
|---|---|---|
| Authentication | `@workos-inc/authkit-nextjs` via `middleware.ts` + `session.ts` | Gained a pilot-access gate (`apps/web/src/lib/pilot-access.ts` + `packages/services/src/pilot-access.ts`, PR-A, finding `#2`) that runs *before* `provisionAccount` — still one canonical entry point (`withSession`), not a second auth path |
| Authorization | `packages/policy/src/authorize.ts` (`authorize()`) | Unchanged as the one policy engine; PR-A closed 8 service-layer callers (`agency.ts`, `platform-roles.ts`) that were bypassing or under-scoping it, not adding a competing engine |
| Consent | `packages/services/src/consent.ts` | Unchanged; PR-A fixed two UI call sites (`app/page.tsx`, `applicant/[id]/documents/page.tsx`) that over-gated read/toggle access on top of it, not the service itself |
| Storage | `apps/web/src/lib/storage.ts` (`createStorage()`) | PR-E1 closed a second, independent blank-`STORAGE_PROVIDER` gap this file had that mirrored `providers.ts`'s own finding `#36` — same canonical function, no new implementation |
| Scanning | `packages/adapters/src/scanner.ts` (`BasicSafetyScanner`) | **Narrowed, not replaced** — PR-B3R deleted PDF content-classification code outright (see §2.2) rather than complete it, closing finding `#9` via a policy change (ADR-0012) instead of the originally-scoped fix |
| Jobs | `packages/services/src/jobs.ts` + `erasure.ts` (its own parallel lease/CAS queue) | PR-B1/PR-C1 brought `erasure.ts` and `jobs.ts` to the identical lease/fencing/CAS pattern (findings `#12`, `#19`, `#21`) — two queues remain by design (different domains: erasure jobs vs. intake jobs), now provably consistent in mechanism rather than accidentally different |
| AI extraction | `packages/services/src/ai.ts` + `packages/adapters/src/openai-extraction.ts` | PR-C2 added a platform-wide advisory lock and fixed two scoring-integrity bugs in the *evaluation harness* (`packages/adapters/src/eval/`) — no new extraction path |
| Document naming | `packages/services/src/naming.ts` + `document-naming.ts` | Unchanged |
| Profile facts | `packages/services/src/profile.ts` | Unchanged |
| Sharing | `packages/services/src/sharing.ts` | Unchanged |
| Agency access | `packages/services/src/agency.ts` | The concern §1 explicitly deferred. PR-A repaired 6 scope/action-check gaps (findings `#3`–`#7`, `#32`); PR-D2 fixed the non-admin visibility bug that made the repaired functions unreachable for their intended `REVIEWER`/`CASE_MANAGER` users (finding `#31`, two Codex rounds) and closed a cross-org assignee leak (round 2). `capabilities.ts`'s `agencyCollaboration`/`bulkExport` now report `available` unconditionally (`KNOWN_SECURITY_GAPS` is an empty set) — the §1 `Keep disabled` gate is closed, current and confirmed correct, not stale (README corrected to match in PR-F1, see §2.5) |
| Missions | `packages/services/src/missions.ts` | PR-D1 fixed a legacy-snapshot-shape crash, a data-loss-on-unclassified-document bug, and an evidence-selection cross-requirement bug (findings `#29`, `#30`, `#33`, `#34`) — same canonical service, no new snapshot format |
| Audit | `packages/services/src/audit.ts` | Unchanged; PR-B2 fixed a lock-ordering deadlock between this module and `documents`/`erasure`/`deletion` (finding `#14`'s extended scope) by standardizing lock-acquisition order across callers, not by changing audit's own code |
| Retention and deletion | `packages/services/src/retention.ts` + `deletion.ts` + `erasure.ts` | PR-B1/B2/C1 closed the multi-version erasure, legal-hold race, and duplicate-job gaps (findings `#12`–`#14`, D-A1) across 5 Codex review rounds on one boundary — same three canonical modules throughout, no parallel erasure path introduced |
| Capability status | `packages/core/src/deployment-mode.ts` + `apps/web/src/lib/capabilities.ts` | Unchanged mechanism; PR-E1 added the readiness route's own provider-validation gate (finding `#36`) and reduced its unauthenticated disclosure surface (finding `#35`) — both consume the existing registry, neither adds a second one |
| UX status labels | `.badge-*` CSS classes | PR-D2 extended coverage (non-admin agency console); no new visual system introduced, confirming §1's "Extend" disposition held for the whole programme |
| **Pilot access (new concern)** | `packages/services/src/pilot-access.ts` + `packages/db` migration `0024` (`pilot_invitations`) | **New**, PR-A, finding `#2`. Not a duplicate of Authentication (WorkOS) or Capability status (deployment mode) — it answers a third, orthogonal question ("is this identity allowed to be provisioned at all in a controlled pilot") that had no owner anywhere before, confirmed by the Phase 0 baseline's own repo-wide grep finding zero pre-existing gating mechanism |
| **Platform-role action matrix (new concern)** | `packages/services/src/platform-roles.ts` (`ACTION_ROLES`, `canPerformPlatformAction`) | **New**, PR-A, finding `#15`. Replaces the previous binary "any active role" checks at every mutating admin call site (`admin.ts`'s `hasPlatformPermission`) with a 9-action → 4-role matrix; the universal `isPlatformAdmin` check is retained only for read-only page-gating, confirmed by direct call-site audit (PR-F1) to have zero remaining mutation-authorizing uses |
| **Exact-SHA CI (new concern)** | `.github/workflows/{ci,deploy-smoke,playwright-smoke,workos-staging-e2e}.yml` (`ref:` pinning) | **New**, PR-E2. `db-migrate.yml` deliberately unchanged (manual `workflow_dispatch`, operator already selects the exact ref) |

### 2.2 Items removed this programme

| Old path/symbol | Reason | Data/migration impact | Test evidence | Rollback |
|---|---|---|---|---|
| `containsActivePdfContent`, `ACTIVE_PDF_CONTENT_MARKERS`, and the full stream/dictionary/filter/predictor PDF parser built on top of them (`packages/adapters/src/scanner.ts`, plus everything from the abandoned PR #68) | Finding `#9`: 8 independent Codex review rounds on the original (PR #68) implementation surfaced 20 distinct correctness findings without ever converging on a sound PDF-content classifier — including one interim fix that had to be self-caught and reverted before review because it broke detection inside genuinely compressed streams. PR-B3R closed the finding by removing its premise (PDF content can be safely classified by this scanner) instead of completing the detection logic — see ADR-0012. | None — no migration; `documentScanResults.safe` semantics for PDFs simply always resolve `false` now, a behavior change (all PDFs unconditionally quarantined) documented as a deliberate, accepted product-security policy, not a data-shape change | `adapters.test.ts`: every PDF, benign or crafted-malicious, returns `safe: false` with an identical, content-non-claiming message; full-pipeline test confirms a PDF reaches `NEEDS_ATTENTION`, never `AWAITING_REVIEW` | Re-adding PDF content classification would require a new adapter behind the same `ScannerPort`, not reverting this deletion — the abandoned code was never merged, so there is nothing to restore from history on `main` |
| The one `pilot-access.test.ts` test relying solely on a fixed-delay "genuinely participates in the lock" signal | D-T3 (register §1.2): discovered, while verifying finding `#52`'s advisory-lock fix, that PGlite fully serializes `db.transaction()` calls regardless of true concurrent contention — this test's PASS was proven to hold identically whether or not the lock code actually ran, making it misleading evidence rather than a weak-but-honest one | None — test-only change | The surviving race test (against the real, full operations, not an artificial delay) plus direct code review of the lock's Postgres semantics carry the correctness claim instead | N/A — removing misleading evidence has no meaningful rollback; the underlying `lockOnEmail` code this test targeted is untouched and still covered by the surviving test |
| `route.test.ts`'s pre-existing "names the specific unmet gates so an operator can act on the 503" test (`apps/web/src/app/api/health/ready/route.test.ts`) | Finding `#35`: this test asserted the OLD, insecure behavior (full 19-gate breakdown exposed unauthenticated on a real deployment) as if it were correct. Replaced, not extended, since its own premise became the vulnerability | None — test-only change | Its "specific gates for an operator" concern is independently covered by `commercial-readiness.test.ts` (which exercises the gate list directly, not through the public HTTP surface) and the new authenticated `/app/admin` breakdown | N/A — the underlying gate logic (`commercial-readiness.ts`) is untouched; only the public route's response shape changed, and that change *is* the fix |

No service, route, server action, adapter, database table, or environment
variable was removed this programme — every numbered finding was a repair
or extension to an existing canonical implementation, not a duplicate
requiring consolidation. This is itself a data point: the Phase 0 baseline
found no competing implementations at the *architecture* level (one
canonical module per concern, confirmed again in §2.1 above); everything
this programme closed was a *correctness* gap inside an already-canonical
module, not a duplication problem. The cleanup directive's removal
machinery (find every import, confirm the replacement covers all behavior,
migrate callers, delete, update docs) was exercised in miniature for the
PDF-parser deletion above; it was never needed at the service/route level
because there was never a second implementation to retire.

### 2.3 Duplicate/orphaned-configuration sweep (PR-F1)

Performed as part of PR-F1's own inventory pass, per the directive's
"Before editing" checklist — env vars, feature flags, dead routes:

- **Env vars**, censused via `grep -rohE "readEnv\('[A-Z_0-9]+'\)"` plus
  `providers.ts`'s `KNOWN_PROVIDERS` map (vars read generically, not by a
  literal `readEnv('X')` call site): `ADMIN_EMAILS`, `AI_ENABLED`,
  `AI_PROVIDER`, `BLOB_READ_WRITE_TOKEN`, `BLOB_SIGNING_SECRET`,
  `CRON_SECRET`, `DEPLOYMENT_MODE`, `NEXT_PUBLIC_APP_URL`,
  `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `OPENAI_API_KEY`,
  `OPENAI_MODEL_PRIMARY`, `OPENAI_PROJECT_ID`, `OPENAI_REASONING_EFFORT`,
  `OPENAI_STORE_RESPONSES`, `PILOT_ALLOWLIST_EMAILS`,
  `STEP_UP_SIGNING_SECRET`, `STORAGE_PROVIDER`, `VERCEL_ENV`,
  `VERCEL_PROJECT_PRODUCTION_URL`, plus the 10 `*_PROVIDER` keys in
  `providers.ts`'s registry (`IDENTITY`, `STORAGE`, `DATABASE`,
  `MALWARE_SCANNER`, `DOCUMENT_CONVERTER`, `AI`, `JOB`, `EMAIL`,
  `OBSERVABILITY`, `PAYMENT`), plus `DATABASE_URL`/`POSTGRES_URL`-family and
  `WORKOS_*` vars read directly by the DB client and
  `@workos-inc/authkit-nextjs` respectively (outside `readEnv`, by
  necessity — those libraries own their own env contract).
  **`ADMIN_EMAILS` vs. `PILOT_ALLOWLIST_EMAILS` looked, at a glance, like a
  possible duplicate** (both are comma-separated bootstrap-email
  allowlists) — confirmed NOT one: `platform-roles.ts`'s own doc comment
  and `pilot-access.ts:15-18`'s doc comment explicitly cross-reference each
  other as deliberately mirroring, but answering two different questions
  (platform-ADMIN bootstrap vs. pilot-ACCESS bootstrap) — this was checked
  by whoever built PR-A, not just assumed safe by PR-F1. No orphaned env
  var found: every one above has at least one live read site outside its
  own test file.
- **Dead routes/CI wiring**: `ux-public.spec.ts` existed but was wired into
  no workflow (finding `#24`) — fixed in PR-F1, the one genuine gap this
  sweep found. `db-migrate.yml`'s red-button history (flagged in §1 as a
  future item) is unchanged — still not load-bearing (migrations apply via
  the Vercel `buildCommand`), still correctly out of scope for a
  non-destructive cleanup pass; not re-flagged as new drift.
  `codeql.yml`/`dependency-review.yml` remain permanently `skipped` on this
  private repo by their own `if: github.event.repository.visibility ==
  'public'` condition — confirmed still intentional (enabling GitHub
  Advanced Security on a private repo is a security-posture decision
  outside a cleanup PR's authority), not newly-discovered drift.
- **`TODO`/`FIXME`/`@deprecated` markers**: zero matches anywhere in
  `packages/*/src` or `apps/web/src` (excluding tests) — confirmed via
  direct grep, not asserted.
- **One stale internal doc link** found and fixed:
  `docs/roadmap/master-build-pilot-commercialization-directive.md` §21
  pointed at `docs/roadmap/pilot-to-commercial-transition.md`, which was
  never created under that name — the real file is
  `docs/operations/pilot-to-commercial-activation.md` (built in the actual
  commercialization PR, just under a different filename than this older
  directive proposed). Corrected in PR-F1.

### 2.4 Dependency hygiene (PR-F1)

`pnpm audit --prod --audit-level high` had drifted from the Phase 0
baseline's clean result to 1 HIGH (`nanoid`, via `next>postcss>nanoid`) + 4
moderate findings — not from a lockfile change, but from advisory
databases updating against an unchanged pin. Closed via three one-line
`pnpm.overrides` version-floor bumps (`nanoid`, `postcss`, `undici`),
following the exact pattern two prior overrides (`sharp`, `postcss`'s
original floor) already established in `package.json`. `pnpm audit --prod`
now reports zero known vulnerabilities. `pnpm audit --dev`'s remaining 6
findings (rooted in `vitest@2.1.9`/`vite@6.4.x`, a major version behind
patched) are deliberately deferred — see
[`../roadmap/remaining-commercial-blockers.md`](../roadmap/remaining-commercial-blockers.md)
§4 for the full reasoning and the exact follow-up this leaves.

### 2.5 Truthful-status-label corrections (PR-F1)

`README.md`'s Quickstart section claimed "296 tests" — stale since before
the Phase 0 baseline (which had already measured 471+1+2=474 and flagged
the README figure as stale, "corrected in the Phase 7 documentation PR" —
this is that PR). Corrected to the freshly-measured, non-cached count: 617
(616 passed + 1 skipped) across 55 files, verified in this same PR's own
verification pass (§5 of `final-programme-verdict.md`).

`README.md`'s Agency & Sharing row claimed collaboration and bulk export
"are currently gated `disabled` in the capability registry pending an
authorization hardening pass" — this was accurate when written (against
the *earlier* 11-PR programme's own state) but is no longer true:
`capabilities.ts`'s `KNOWN_SECURITY_GAPS` set is empty and
`agencyCollaboration`/`bulkExport` both resolve `available`
unconditionally, with the module's own doc comment recording that the
hardening pass referenced completed and is covered by
`agency.test.ts`/`organizations.test.ts`. Corrected to match current code,
citing the specific tests that now prove it.

### 2.6 Rollback consideration for this programme's cumulative diff

Every fix across PR-A through PR-F1 is additive or narrows an existing
code path (a stricter check, an extra column, a corrected query predicate)
— none rewrites an applied migration (all corrective changes are new,
forward-only migrations, per the cleanup directive's own "never rewrite
applied migration files" rule), none removes audit history, none weakens
an existing security control to pass a test. Reverting any single PR in
this sequence requires no data migration undo beyond the ordinary
`DOWN`-less-but-additive Drizzle pattern this codebase already uses
throughout; the one behavioral deletion (PDF content classification, §2.2)
is a policy tightening (more conservative, not less) and would need a new
adapter to relax, not a revert of anything destructive.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
