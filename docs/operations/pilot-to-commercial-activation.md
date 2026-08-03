# Pilot-to-commercial activation (PR 11)

Authority: `docs/roadmap/commercial-recovery-completion-ux-directive.md` §7 "PR
11 — Commercial activation framework."

This is the operator's guide to moving VisaStack from controlled pilot to
commercial mode. It documents the provider registry (what each `*_PROVIDER`
env var does), the commercial readiness guard (every gate that must be true
before commercial mode may serve real applicants), and the activation
sequence. It does not itself perform activation — activation is a
configuration act (setting env vars on the real infrastructure this
describes), not a code change.

## 1. The model: configuration, not business-logic edits

Every port the directive names (`IdentityPort`, `StoragePort`,
`MalwareScannerPort`, `DocumentConverterPort`, `AiExtractionPort`,
`JobQueuePort`, `EmailPort`, `ObservabilityPort`, `PaymentPort` —
`packages/services/src/ports.ts`, plus `storage.ts`/`extraction.ts`/`ai.ts`
for the four that predate this PR) has a genuine pilot implementation today.
Commercial activation for a port that already HAS a real, working commercial
adapter (identity, storage, database, AI, jobs) is a config change: set the
matching env var and the deployment's real infrastructure. Commercial
activation for a port that does NOT yet have a real adapter beyond the pilot
one (malware scanning, email, payments) requires building that adapter first
— no env var can conjure an adapter that doesn't exist. The provider registry
(`apps/web/src/lib/providers.ts`) is what makes a `*_PROVIDER` var either take
effect or fail loudly (an unrecognized value throws, naming exactly what this
deployment implements) — it never silently ignores a value it doesn't
recognize.

## 2. Provider registry

All `*_PROVIDER` vars are optional. Unset means "use the pilot default,"
which is what every var currently resolves to. Setting one to a value this
deployment doesn't implement throws at construction time (`providers.ts`) —
never a silent fallback.

| Var | Pilot default | Commercial value | Notes |
| --- | --- | --- | --- |
| `IDENTITY_PROVIDER` | `workos` | `workos` | Only implementation today (`apps/web/src/lib/identity-provider.ts`'s `WorkosIdentityPort`). Commercial activation is a WorkOS **production** project, not a new adapter — see §3's `workosProduction` gate. |
| `STORAGE_PROVIDER` | `neon` (via `BLOB_READ_WRITE_TOKEN` absence) | `vercel_blob` | Cross-checked against `BLOB_READ_WRITE_TOKEN` in `apps/web/src/lib/storage.ts`'s `createStorage` — setting `vercel_blob` without the token throws; setting `neon` on a real deployment throws (reduced-control storage is dev/test/preview-only). |
| `DATABASE_PROVIDER` | `neon` | `neon` | No dedicated port — Drizzle-over-Neon is accessed directly (`@visastack/db`). Validated for a recognized value; there is no second implementation to switch to. |
| `MALWARE_SCANNER_PROVIDER` | `builtin` | *(none exists)* | `BasicSafetyScanner` is structural/magic-byte validation, not antivirus (ADR-0011). There is no commercial value to set — see §3's `realMalwareScanner` gate, which cannot pass until a real adapter is built. |
| `DOCUMENT_CONVERTER_PROVIDER` | `builtin` | `builtin` | `DeterministicTextExtractor`'s bounded parsing + resource controls (PR 3) are commercial-grade already — no swap needed. |
| `AI_PROVIDER` | `openai` (requires `AI_ENABLED=true`) | `openai` | Already fully config-gated (`apps/web/src/lib/ai.ts`'s `createAiExtractor`) since before this PR. Commercial activation needs a **production** OpenAI project (`OPENAI_PROJECT_ID`) if AI is enabled — see §3. |
| `JOB_PROVIDER` | `neon` | `neon` | No alternate implementation exists; the Postgres-native worker (`packages/services/src/jobs.ts`) satisfies `JobQueuePort`'s shape by construction, not by being selected from a registry. |
| `EMAIL_PROVIDER` | `none` (`NullEmailPort`, logs only) | *(none exists)* | The directive's own pilot-provider list names no email provider. A real provider is a future PR. |
| `OBSERVABILITY_PROVIDER` | `console` (`ConsoleObservabilityPort`) | `console` | Structured JSON to stdout, aggregated by Vercel's own log viewer — genuinely sufficient today; not a placeholder. |
| `PAYMENT_PROVIDER` | `none` (`NullPaymentPort`, always throws) | *(none exists)* | The directive is explicit: "no payment provider." `PaymentPort.configured` stays `false` until one is built. |

## 3. Commercial readiness guard

`DEPLOYMENT_MODE=commercial` alone does **not** unlock commercial-only
behavior. `/api/health/ready` runs the full guard
(`apps/web/src/lib/commercial-readiness.ts`) and returns HTTP 503 —
with `publicSignup`/`realApplicantData`/`commercialClaims` forced to
`disabled` in its own response — unless every gate below is true. The
general-purpose capability registry (`apps/web/src/lib/capabilities.ts`)
independently keeps those same three capabilities `disabled` in commercial
mode unless the configuration-checkable gates pass, so nothing elsewhere in
the app can show commercial behavior as available while the guard is failing
either. **No normal administrator may override this guard** — there is no
bypass flag; every gate must genuinely become true.

| Gate | Kind | How it's satisfied |
| --- | --- | --- |
| commercial-compatible hosting | Live | `VERCEL_ENV=production` |
| WorkOS production | Live + attested | WorkOS env vars configured **and** `COMMERCIAL_READINESS_ATTEST_WORKOS_PRODUCTION=true` (env presence alone can't distinguish a production WorkOS project from staging) |
| production database | Live | `/api/health/ready`'s own DB connectivity + migration check (the one gate `commercial-readiness.ts` cannot verify itself — it's supplied by the readiness route) |
| private production storage | Live | `BLOB_READ_WRITE_TOKEN` configured |
| real malware scanner | **Never attestable** | Hardcoded `false`. Becomes true only once a real `MalwareScannerPort` adapter (e.g. ClamAV) is built and registered — a genuine future PR, not a config change |
| safe conversion | Built-in | Hardcoded `true` — PR 3's bounded, hostile-tested `DeterministicTextExtractor` is complete |
| step-up | Live | `STEP_UP_SIGNING_SECRET` configured |
| external-object deletion verification | Attested | `COMMERCIAL_READINESS_ATTEST_EXTERNAL_DELETION_VERIFIED=true` — confirm against the live storage provider that erasure jobs (`packages/services/src/erasure.ts`) genuinely remove bytes, not just DB rows |
| tenant-isolation suite | Attested | `COMMERCIAL_READINESS_ATTEST_TENANT_ISOLATION_SUITE=true` — CI's tenant-isolation/hostile-authorization suite (`packages/services/src/tenant-isolation.test.ts` and friends) is green on the deployed commit |
| permission matrix | Attested | `COMMERCIAL_READINESS_ATTEST_PERMISSION_MATRIX=true` — the full role×resource×action matrix (`docs/security/tenant-isolation-matrix.md`) has been reviewed against the deployed commit |
| production OpenAI project where AI is enabled | Live | If `AI_ENABLED≠true`, trivially satisfied. Otherwise: `createAiExtractor()` configured **and** `OPENAI_PROJECT_ID` present |
| privacy/consent configuration | Attested | `COMMERCIAL_READINESS_ATTEST_PRIVACY_CONSENT_CONFIG=true` — real consent copy/config reviewed, not placeholder |
| retention/deletion workflow | Built-in | Hardcoded `true` — PR 4's retention/erasure/deletion workflow is complete and tested |
| backup restore verification | Attested | `COMMERCIAL_READINESS_ATTEST_BACKUP_RESTORE_VERIFIED=true` — the restore drill in `docs/operations/recovery.md` has actually been run and measured |
| authenticated production E2E | Attested | `COMMERCIAL_READINESS_ATTEST_PRODUCTION_E2E=true` — the browser E2E journeys (master directive §8) have run against the deployed commercial environment |
| incident owner | Attested | `COMMERCIAL_READINESS_ATTEST_INCIDENT_OWNER=true` — a named human owns incident response (tracked outside this env var; the flag is a boolean by design so no name/PII appears in a health-check response) |
| terms and privacy notice | Attested | `COMMERCIAL_READINESS_ATTEST_TERMS_AND_PRIVACY_NOTICE=true` — a real, published terms/privacy page exists (none exists in the app yet; do not set this until one does) |
| no Critical/High findings | Attested | `COMMERCIAL_READINESS_ATTEST_NO_CRITICAL_HIGH_FINDINGS=true` — the latest `pnpm audit --prod --audit-level high` and any code-security review on the deployed commit are clean |
| external penetration test | Attested | `COMMERCIAL_READINESS_ATTEST_EXTERNAL_PENTEST=true` — a completed, dated external pentest with no unresolved Critical/High findings |

Setting an attestation flag to `true` is a claim that the named work has
genuinely been done. Do not set one to unblock a deploy — it exists to
record, not to bypass.

## 4. Activation sequence

1. Provision the real infrastructure: a WorkOS **production** environment, a
   Neon production database/branch, a Vercel Private Blob store, an OpenAI
   production project (only if AI will be enabled).
2. Run and pass every attestable gate in §3 for real — the restore drill, the
   pentest, the tenant-isolation suite, the E2E journeys, the security
   review, a published terms/privacy page, a named incident owner.
3. Build a real `MalwareScannerPort` adapter. This is the one gate that
   requires code, not configuration — commercial mode cannot go live before
   this exists.
4. Set the provider vars from §2 and `DEPLOYMENT_MODE=commercial` on the real
   production environment.
5. Set every `COMMERCIAL_READINESS_ATTEST_*` flag from §3 to `true`, and only
   after the work it names is genuinely done.
6. Check `GET /api/health/ready`. It must report `"status": "ready"` (HTTP
   200) and `commercialReadiness.ready: true` with every gate `satisfied:
   true`. Until then, commercial mode stays inert: public capabilities report
   `disabled` everywhere in the app, and the endpoint returns 503.

## 5. What this document does not cover

This document describes the mechanism (provider registry + readiness guard)
and what each gate requires. It is not itself: the terms of service or
privacy notice (§3's `termsAndPrivacyNotice` gate), the pentest engagement,
the legal/compliance review, or the `MalwareScannerPort` adapter's
implementation. Each is real, separate work the gates above name but do not
perform.
