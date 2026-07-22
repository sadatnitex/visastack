# VisaStack Reliability & Document-Intelligence Upgrade — governing directive

> **Superseded on infrastructure, sequencing and commercialization policy** by
> [`master-build-pilot-commercialization-directive.md`](./master-build-pilot-commercialization-directive.md),
> which is now the current governing directive. This document's milestone
> content (Milestones 0–11) still stands and is being executed through that
> directive's PR sequence (§26); read the master directive first for authority
> order and current scope. Progress is tracked in
> [`docs/audits/current-product-baseline.md`](../audits/current-product-baseline.md)
> and in the pull request for branch
> `claude/visastack-reliability-document-intelligence`.

## Mission

Upgrade the current VisaStack technical preview into a reliable, secure,
genuinely useful internal alpha that implements the product's highest-value
end-to-end workflow:

> An applicant uploads or scans a document, VisaStack safely processes it,
> proposes the correct document classification and filename, proposes clearly
> sourced Master Profile updates, the applicant approves or edits each change,
> and authorized users can preview or download only what their permission
> allows.

Do not merely create plans, schemas, interfaces, documentation or disconnected
screens. Implement working vertical slices and prove them against the deployed
application.

## Capability truth-labelling

Classify every capability as exactly one of: **Domain model only · Service
implemented · UI present · Infrastructure wired · Preview verified · Production
verified · Commercial-launch verified.** Only the last three may be described as
"working"/"live"/"complete", with the exact environment stated.

## Confirmed baseline to preserve

- WorkOS AuthKit login reaches the authenticated workspace.
- Middleware owns session enforcement + token refresh; `/callback` is the auth
  callback; `withSession()` reads the refreshed session.
- The Neon WebSocket mitigation MUST remain: `serverExternalPackages`,
  `WS_NO_BUFFER_UTIL`, `WS_NO_UTF_8_VALIDATE`, pool error listener,
  `apps/web/src/instrumentation.ts`.

## Confirmation-required actions (never without explicit sign-off)

Delete/rewrite production applicant data · rotate/expose secrets · change
billing or purchase infra · disable the working production auth config · promote
to production · destructive production migrations · weaken security controls to
pass tests.

## Required implementation order (vertical, not horizontal)

- **Release A — Reliable Applicant Core:** login regression tests · WorkOS user
  ID binding · honest readiness · persistence · manual profile · history · safe
  owner access · correct documentation.
- **Release B — Secure Document Vault:** private async upload · real scanner
  config · clean/quarantine separation · safe owner preview · approved-filename
  download · access + audit hardening.
- **Release C — Document-to-Profile MVP:** real extraction · filename proposal ·
  persisted field proposals · review UI · selective atomic approval · provenance
  + correction feedback.
- **Release D — Target-Group Profile:** universal core · professional · business
  traveler · medical traveler/attendant · funding & host records.
- **Release E — Permissioned Collaboration:** shared workspace · agency case
  inbox · evidence requests · reviewer workflow · revocation tests.
- **Release F — Missions & Packs:** requirement composition · evidence mapping ·
  readiness · grounded outputs · versioned application pack.

Do not start a later release while an earlier one has unresolved P0 defects.

## Milestones (summary)

0. **Protect the working login** — regression tests (Playwright) for the 9 auth
   invariants; correct identity binding to immutable `workosUserId` via a staged
   non-destructive migration; protect the Neon `ws` fix with a real-transaction
   smoke.
1. **Honest health & release gates** — `/api/health/ready` returns 503 when a
   required core dependency is down/unmigrated; separate capability registry
   (available/degraded/disabled/unconfigured); deployed-preview smoke workflow;
   production promotion blocked on smoke failure.
2. **Close the document-access security gap (P0)** — preview labelled "redacted"
   currently serves original bytes; third-party PREVIEW must not expose
   originals; real preview-rendition model; download-time re-authorization,
   step-up, approved `Content-Disposition` filename, `Cache-Control:
   private, no-store`; remove PII from logs.
3. **Safe asynchronous document intake** — server upload intent, opaque object
   keys, private quarantine storage, server-side SHA-256, durable idempotent
   jobs, private production S3-compatible adapter behind existing ports (fail
   closed when only reduced-control mode available).
4. **Real document processing** — actual work per state (UPLOADING → QUARANTINED
   → SCANNING → NORMALIZING → EXTRACTING → AWAITING_REVIEW → APPROVED /
   NEEDS_ATTENTION / FAILED / REJECTED); real safety controls; launch formats;
   deterministic extraction before AI.
5. **Production AI Gateway** — provider-neutral gateway on the OpenAI Responses
   API, model `gpt-5.6-terra`, lowest passing reasoning effort; strict
   Structured Outputs; canonical-field enforcement; data minimization; cost
   controls; manual no-AI path preserved.
6. **Persisted document intelligence** — `ProcessingRun`, `ExtractionRun`,
   `DocumentClassification`, `DocumentNameVersion`, `FieldProposal`,
   `EvidenceLocation`, `ProposalDecision`, `Conflict`, `CorrectionFeedback`,
   `GeneratedRendition` (reviewed reversible migrations; never in-memory only).
7. **Automatic document naming** — `Document Type - Primary Subject - Issuer or
   Context - Relevant Date or Period [ - vN].ext`; original preserved forever;
   editable components; immutable name-version records.
8. **Document-to-profile review experience** — preview beside sourced proposals;
   NEW/MATCH/UPDATE/CONFLICT/UNMAPPED/UNCERTAIN; per-proposal approve/edit/reject;
   atomic all-or-nothing approval with failure-injection tests.
9. **Master Profile for the launch groups** — canonical Field Registry +
   composable packs (universal core; professional; business; medical); no
   hard-coded eight-field passport subset.
10. **Usable shared & agency workspaces** — permission-filtered recipient
    workspace; agency case inbox with human-readable selectors; membership stays
    access-neutral.
11. **Mission Workspace & Packs** — real work area; readiness = coverage /
    validity / consistency / sources / open items, never approval probability.

## Definition of done

Implemented · connected to real UI · authorized · consent-gated where required ·
persisted · audited · tested · deployed to preview · verified through the actual
user journey · documented truthfully · observable · recoverable · reversible ·
supported operationally. "Schema/service/port exists", "unit test passes",
"build succeeds", "Vercel deploy succeeds" are NOT individually sufficient.

## Security release gates (no public commercial release until all pass)

No unresolved Critical/High findings · preview/original separation proven ·
tenant-isolation tests pass · permission-matrix tests pass · WorkOS identity
binding corrected · step-up works · real malware control active · private
production object storage active · no production data in dev/preview · account
export/deletion works · backup-restore drill passes · incident tabletop passes ·
external pen-test passes · EN/BN critical paths pass · accessibility gate passes ·
AI/document benchmarks pass · production E2E passes. These gates may not be
weakened by renaming them "accepted risks".

## This session's execution order

1. Pull/verify latest `main`; create the upgrade branch. ✅
2. Save this directive. ✅
3. Read all authoritative documents and recent auth hotfixes (PRs 29–39).
4. Create the truthful baseline audit.
5. Run the full existing check suite.
6. Verify the deployed login + authenticated persistence via a safe method.
7. Implement Release A.
8. Implement the P0 document-preview security correction.
9. Add preview deployment smoke tests.
10. Continue into Release B only when Release A + P0 security tests pass.
11. Do not stop at analysis unless an external secret, production-data mutation
    or paid-resource decision is the sole blocker.
12. Open the PR (do not auto-merge) and report what is production-verified /
    preview-verified / implemented-unverified / blocked, with exact tests.
