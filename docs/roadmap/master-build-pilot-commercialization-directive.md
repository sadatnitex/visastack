# VisaStack Master Build, Pilot and Commercialization Directive

> This is the current **governing directive**, reproduced verbatim from the
> engagement brief. It **supersedes**
> [`reliability-document-intelligence-upgrade.md`](./reliability-document-intelligence-upgrade.md)
> wherever the two conflict on infrastructure, release sequencing, or
> commercialization policy (see "Authority and precedence" below); the earlier
> document's milestone content otherwise still applies and is being executed
> through the PR sequence in §26 of this directive. Progress is tracked in
> [`docs/audits/current-product-baseline.md`](../audits/current-product-baseline.md)
> and in PR #40 (`claude/visastack-reliability-document-intelligence`) followed
> by the PR sequence below.

## 1. Authority and precedence

Read completely before changing code: `docs/product/prd-v1.1.md`,
`docs/product/build-spec-v1.1.md`, `docs/roadmap/acceptance-criteria.md`,
`docs/roadmap/phase-plan.md`, `docs/roadmap/reliability-document-intelligence-upgrade.md`,
`docs/audits/current-product-baseline.md`, `docs/security/threat-model.md`,
`docs/architecture/`, `docs/adr/`, `docs/operations/`, `README.md`, current
application/db/policy/service/adapter/test/workflow code, and recent auth/reliability
PRs #29–#40.

**Authority order:** (1) PRD + Build Spec safety/security/product-ownership laws,
(2) this directive's infrastructure, release sequencing and commercialization
policy, (3) ADRs, (4) roadmap/docs, (5) existing code. This directive supersedes
earlier execution prompts when they conflict on: paid infrastructure, S3/KMS,
OpenAI activation, pilot status, Vercel Hobby, WorkOS staging, commercialization,
branch/PR sequencing. Never weaken the PRD's applicant ownership, authorization,
audit, provenance, manual-approval, versioning or security requirements.

## 2. Product objective

Build the full journey: sign in → create/select applicant → upload/scan a
document → safe processing → proposed document type + formatted filename →
sourced Master Profile proposals → applicant approves/edits/rejects each → authorized
users preview/download only what their permission expressly allows.

VisaStack must become an **applicant-controlled, reusable mobility profile and
evidence workspace** — applicants, family, agencies and reviewers collaborate
without an organization ever gaining permanent ownership of the applicant's data.
Initial target groups: regular tourists, business tourists/owners, travelling
professionals, medical tourists, medical attendants, family-funded/sponsored
travelers. VisaStack must NOT reduce to: a document folder, a checklist, an
agency CRM, an AI chatbot, a single-country form, a public file-sharing service,
or an approval-probability tool.

## 3. One codebase, three deployment modes

```ts
type DeploymentMode = "development" | "controlled_pilot" | "commercial";
```

- **development** — local/tests/synthetic fixtures/mock adapters/PR previews. No real applicant data.
- **controlled_pilot** — **current operating mode.** Private GitHub repo, GitHub Actions, Vercel Hobby, Neon Free, WorkOS staging, Vercel Private Blob, OpenAI API pilot project, restricted internal testers, synthetic/irreversibly-redacted documents initially. Low-cost controlled internal pilot, NOT commercial production.
- **commercial** — future mode. Same domain model/flows/ports/policy engine/audit/schemas/UI as pilot — never a separate codebase. Activates only after its mandatory gates (§22) pass.

## 4. Central capability registry

Server-derived only — the client never decides if a capability is active.

```ts
interface PlatformCapabilities {
  authentication: CapabilityState; manualProfile: CapabilityState;
  documentUpload: CapabilityState; structuralValidation: CapabilityState;
  malwareScanning: CapabilityState; normalization: CapabilityState;
  deterministicExtraction: CapabilityState; aiExtraction: CapabilityState;
  documentNaming: CapabilityState; proposalReview: CapabilityState;
  ownerPreview: CapabilityState; thirdPartyPreview: CapabilityState;
  originalDownload: CapabilityState; redactedDownload: CapabilityState;
  profileExport: CapabilityState; agencyCollaboration: CapabilityState;
  missionWorkspace: CapabilityState; packGeneration: CapabilityState;
  publicSignup: CapabilityState; payments: CapabilityState;
  realApplicantData: CapabilityState; commercialClaims: CapabilityState;
}
type CapabilityState = "available" | "degraded" | "disabled" | "unconfigured";
```

Derived from deployment mode, verified env config, required migrations, adapter
availability, security controls, release gates, usage quotas. UI must never
advertise a disabled/degraded/unconfigured capability as live. Commercial mode
fails readiness if a mandatory commercial capability is absent; pilot mode stays
manually usable when AI/optional processing is unavailable.

## 5. Current infrastructure policy

**Approved now:** GitHub + Actions, Vercel Hobby (non-commercial/pilot), Neon
Free, WorkOS staging, Vercel Private Blob (pilot objects), OpenAI API (limited
pilot budget), deterministic/mock processing, DB-backed jobs for low pilot volume.

**Not approved now:** AWS S3, AWS KMS, SQS, paid Inngest, paid Upstash, paid
malware-analysis APIs, paid observability, other paid infra, public payments.
Keep provider interfaces replaceable; do not block the build waiting for S3/KMS.

**Commercial future:** Vercel Pro (or equivalent), WorkOS production, a
production-appropriate Postgres plan, Vercel Private Blob on a commercial plan,
optionally a private S3-compatible provider later for customer-managed
keys/independent storage/region, real malware scanning + isolated conversion, a
separate OpenAI production project, stronger monitoring/recovery/incident tooling.
S3/KMS is NOT automatically required for first commercial release if Private
Blob satisfies the approved requirements.

## 6. Truthful product status

While on Vercel Hobby + WorkOS staging, show: **"VisaStack Technical Preview —
controlled internal testing."** Never claim: commercial launch, production-ready,
enterprise-grade, fully secure, suitable for unrestricted customer documents,
end-to-end AI intelligence without an active AI adapter, antivirus protection
under structural-validation-only, "redacted preview" without a real redacted
rendition, immediate revocation when an issued capability remains usable, or
"phases complete" from schemas/services alone.

**Labels:** Domain model only · Service implemented · UI connected ·
Infrastructure configured · Preview verified · Pilot verified · Production
verified · Commercially verified. A feature is "working" only when its real user
path is connected and verified in the stated environment.

## 7. Action and approval boundaries

**Without asking:** read repo/history, create branches, edit code/docs, add
non-destructive migrations, add tests/fixtures, run lint/typecheck/build/test,
create preview deployments via normal GitHub/Vercel flow, commit, open/update
PRs, add mock/deterministic/unconfigured adapters, add env-variable contracts,
add migration dry-run tools, add internal capability/usage dashboards.

**Explicit approval required — never do without it:** merge a PR, push directly
to `main`, promote to production, rotate/expose secrets, purchase/activate paid
infra, destructive production migrations, delete real production records, enable
public signup, enable payments, process unrestricted real-client documents,
activate commercial mode, weaken a security control to pass a test.

Do not repeatedly ask about S3/KMS or paid services — record commercial
blockers once (this doc + the audit) and continue all work implementable
without them.

## 8. Immediate task: complete PR #40 only

PR #40 already contains (preserve): WorkOS immutable-id account binding +
migration `0010` + takeover guards, honest 503 readiness, PII-safe logs,
truthful docs, P0 third-party-preview-original-bytes prevention. **Do not** add
storage migration, full document intelligence, profile packs, or OpenAI to #40.

Add to #40: (A) no-secret smoke tests — `/api/health/live` reachable; healthy
`/ready` → 200; degraded `/ready` → 503; unauthenticated `/app` redirects to
WorkOS; `/callback` publicly reachable; landing/status render; protected routes
don't leak before auth; auth errors give recoverable messaging + a safe reference
id. (B) Playwright foundation — auth redirect, callback reachability,
authenticated workspace, applicant creation, fact save/reload, logout,
re-sign-in, persistence, unauthorized denial, session termination. (C) Optional
authenticated WorkOS-staging E2E workflow — runs only when required secrets
exist, clearly skipped otherwise, fails clearly if misconfigured, synthetic
identities only, never production credentials, never logs credentials/tokens,
no real applicant data, cleans up where safe; document exact secret names
without values. (D) Real pooled-Neon transaction regression, protecting
`serverExternalPackages`, `WS_NO_BUFFER_UTIL`, `WS_NO_UTF_8_VALIDATE`,
`instrumentation.ts`, pool error handling, middleware-owned token refresh. (E)
Update the PR: preview URL, tests passed/skipped, manual checks required,
migration list, remaining P0 risks, rollback plan, production-verification
status, commercial blockers. **Do not merge. Stop and wait for explicit approval.**

## 9. Post-PR #40 release process

After #40 is reviewed and explicitly approved: confirm branch is current with
`main` → rerun all checks → confirm migration `0010` is additive/safe → merge
only on explicit instruction → monitor the deployment → run production smoke →
revert the merge if core login/data path fails → branch the next release from
updated `main`. Never keep extending one giant PR.

## 10–20. Release B → Pilot measurement (full detail retained from brief)

The directive's full text for Release B (Vercel Private Blob + async intake,
quotas, existing-byte migration tool, low-volume durable jobs), Release C (real
deterministic processing states, structural validation, supported formats,
deterministic extraction, rules-based classification, the naming pattern
`Document Type - Primary Subject - Issuer or Context - Relevant Date or Period [ - vN].ext`),
Release D (OpenAI Responses API adapter, `gpt-5.6-terra`, env contract, privacy
minimization, cost controls, initial AI tasks, AI authority limits), §13
persisted-intelligence-record migrations, Release E (document-to-profile review,
proposal types, atomic approval), Release F (universal core + professional /
business / medical profile packs), Release G (shared workspace + Agency Desk +
permission re-evaluation), Release H (Mission Workspace + Packs), §18 safe
preview/download rules, §19 pilot usage/admin dashboard, §20 pilot data policy —
apply exactly as specified in the original brief and are executed through the PR
sequence in §26 below. (Reproduced in full in the engagement transcript; this
summary exists so the sequencing and gates are visible in-repo without
duplicating thousands of words across two files.)

## 21. Commercial transition: what changes where

Tracked in a dedicated companion document:
[`docs/roadmap/pilot-to-commercial-transition.md`](../operations/pilot-to-commercial-activation.md)
(to be created alongside the commercialization PR, §26 item 9) — a concrete
per-system checklist (application code / Vercel / WorkOS / Neon / file storage /
OpenAI / malware & conversion / legal & operations) for what changes between
`controlled_pilot` and `commercial`.

## 22. Commercial readiness guard

Commercial mode must return HTTP 503 and keep public onboarding disabled when
any required gate is false: commercial-compatible hosting, WorkOS production,
production DB configuration, private production storage, real malware scanning,
safe rendition/original separation, OpenAI production project (if AI enabled),
consent/privacy configuration, retention/deletion, backup-restore test,
tenant-isolation test, permission-matrix test, production authenticated E2E,
incident-response owner, no unresolved Critical/High finding, external
pen-test, approved terms/privacy policy. No ordinary admin may override these
gates; an emergency override (if ever built) requires elevated authorization,
multiple explicit confirmations, a recorded reason, expiry, audit, and a visible
critical warning — and is NOT to be implemented during the pilot unless
specifically authorized.

## 23–25. Testing, UX, pilot measurement

Full requirements (unit / DB integration / upload & parser security / browser
E2E / preview-deployment smoke; mobile-first + desktop-efficient + EN/BN +
WCAG 2.2 AA UX; privacy-preserving pilot product events + scorecard) apply as
specified in the original brief and are executed incrementally through the PR
sequence below — each PR's test section states exactly what was added.

## 26. Pull-request sequence

After PR #40: separate PRs, never one giant PR, each branched from the latest
approved `main`, each stopping for explicit approval before merge:

1. **PR #40** — Reliable Applicant Core, smoke tests, P0 preview safety. *(in progress)*
2. **Storage PR** — Vercel Private Blob + low-volume async intake.
3. **Processing PR** — Deterministic extraction + automatic naming.
4. **AI PR** — OpenAI adapter, persisted proposals, review workflow.
5. **Profile PR** — Universal + target-group Master Profile packs.
6. **Collaboration PR** — Shared workspace + Agency Desk.
7. **Mission PR** — Requirement mapping, readiness, pack production.
8. **Pilot-hardening PR** — Bangla, accessibility, recovery, usage controls, pilot measurement.
9. **Commercialization PR** — production configuration guards + commercial-activation prep.

Every PR: branch from latest approved `main`, coherent scope, no auto-merge, full
CI, preview deployment, test evidence, migrations identified, environment
changes identified, cost impact stated, pilot status stated, commercial
compatibility + blockers stated, rollback included, stop for approval.

## 27. Definition of done

Implemented · connected to real UI · authorized · consent-gated where required ·
persisted · audited · tested · preview deployed · verified through the actual
user journey · truthfully documented · observable · recoverable · reversible ·
within configured limits. NOT sufficient alone: schema/interface/service exists,
unit test passes, build passes, Vercel deploy succeeds, docs say "complete", a
domain invariant exists without a user path.

## 28. This session's execution instruction

1. Pull the latest PR #40 branch. ✅
2. Verify the existing changes and migration `0010`. ✅
3. Add the no-secret smoke tests.
4. Add the Playwright foundation.
5. Add the optional WorkOS-staging authenticated E2E workflow.
6. Add the real pooled-Neon regression check.
7. Run lint, typecheck, unit, integration and build tests.
8. Update PR #40.
9. Generate a Vercel preview (automatic on push).
10. Report manual checks.
11. **Do not merge.**
12. Do not begin the storage or OpenAI PR until #40 is explicitly approved and merged.

End-of-session report must include: branch, PR, head commit, preview
deployment, tests passed/skipped, manual verification, migrations, required env
vars, pilot-ready / commercial-compatible / production-verified capabilities,
remaining P0/P1 issues, commercial blockers, rollback procedure.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance. Production uses private R2 storage; database-only encrypted archive recovery is verified, while complete document/key/lifecycle recovery remains open.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
