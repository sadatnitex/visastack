# VisaStack — integration and cleanup map

Maintained per
[`docs/governance/integration-and-cleanup-directive.md`](../governance/integration-and-cleanup-directive.md).
Updated with every PR in the commercial-readiness programme. This entry
covers **PR 1** only.

## Canonical implementation per concern (as of PR 1)

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

## Duplicate/competing implementations found

**None.** The Phase 0 inventory (three parallel Explore passes across docs,
application code, and tests/CI/migrations) found no competing
authorization path, no duplicate service, and no second copy of any
canonical concern. The one area that looked like it might duplicate
existing work — `VERCEL_ENV === 'production'` environment detection —
turned out to be exactly two narrow, single-purpose call sites
(`storage.ts`, `health/ready/route.ts`), not a competing abstraction; PR 1
consolidates both onto the new canonical helper rather than leaving a third
parallel check alongside them.

## Items removed or merged this PR

None. PR 1 is additive (new capability-status module) plus two small
call-site migrations onto it. No dead code, orphaned config, or duplicate
test was identified as safe to remove in this pass — the cleanup
directive's "remove only when proven safe" bar was not met for anything
found, and removal was not necessary to accomplish PR 1's objectives.

Two non-code items are flagged for a future, separate cleanup (not
executed here, to avoid scope creep into PR 1):

- `.github/workflows/db-migrate.yml` is a manual workflow that has failed
  100% of its 7 historical runs (no DB secret configured) and has not been
  re-run since 2026-07-20 even though six migrations have shipped since —
  it is currently a permanently-red button in the Actions tab. Rollback
  consideration if later deleted/fixed: it is not load-bearing (migrations
  apply via the Vercel build command instead), so removing or fixing it
  carries no data/migration risk either way — deferred to a documentation
  or CI-hygiene PR, not this one.
- `codeql.yml` / `dependency-review.yml` are both permanently `skipped` on
  this private repository (`if: github.event.repository.visibility ==
  'public'`). Not touched in PR 1 (changing this is a security-posture
  decision — enabling GitHub Advanced Security on a private repo — outside
  PR 1's scope), but recorded here so it isn't mistaken for newly-discovered
  drift in a later PR.

## Rollback consideration for PR 1's new code

The entire PR 1 diff is additive (new files) plus two call-site edits that
each replace one `readEnv('VERCEL_ENV') === 'production'` expression with
an equivalent call to the new helper — behaviorally identical, verified by
existing tests in `storage.test.ts` and `route.test.ts` continuing to
pass unmodified. Reverting the PR requires no migration and no data
change; capability-gated server actions fail back to their pre-PR
(ungated) behavior, which is why the specific gates chosen here were
limited to the capabilities with confirmed defects rather than applied
broadly.
