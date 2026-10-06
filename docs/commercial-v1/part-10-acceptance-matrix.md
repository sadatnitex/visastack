# Part 10 section 4: acceptance matrix A01 to A35

Written 2026-10-06 (Part 10 sections 1 to 4, first pass). Code under test: see the SHA in `docs/commercial-v1/part-9-checkpoint.md`. Environment: local sandbox (Node 22, PGlite for service tests, a production build served locally for browser checks) plus read-only fetches of the live site.

**How states are decided.** PASS only when the whole scenario was executed and proved on this commit with no external system and no known gap. A passing unit test is recorded in the tests column and does not, by itself, upgrade a row (the directive says service tests do not substitute for journey proof). BLOCKED means something outside this session is missing (a second identity, a live provider, a person, an owner decision). NOT_EXECUTED means nothing external is missing but the scenario has not been run end to end. No row is marked N/A.

| ID | Topic | Implementation | Automated tests that exist | State | What is missing |
|---|---|---|---|---|---|
| A01 | Identity and MFA | WorkOS sign-in, step-up (`step-up.ts`), pilot access | `step-up.test.ts` (services and web), `identity-provider.test.ts`, `session-age.test.ts`, `pilot-access.test.ts` | BLOCKED | No real sign-in here; staff MFA is not enforced (known gap); needs the staging identities |
| A02 | Revocation | `sharing.ts`, token re-check at redemption | `sharing.test.ts`, `document-access-token.test.ts`, `blob-token.test.ts` | BLOCKED | Pause, revoke and resume through the UI need two identities (test written, skipped) |
| A03 | Tenant boundaries | `tenant-isolation` checks in every query, `docs/security/tenant-isolation-matrix.md` | `tenant-isolation.test.ts`, `organizations.test.ts`, `agency.test.ts` | BLOCKED | Cross-account UI proof needs two identities and the agency fixture |
| A04 | Grant precision | `sharing.ts` action, category and document scopes | `sharing.test.ts` | BLOCKED | Recipient-side view of a narrow grant needs two identities |
| A05 | Invitation | `invitations.ts`, `client-invitations.ts`, `contributor-requests.ts` | `invitations.test.ts`, `client-invitations.test.ts`, `contributor-requests.test.ts` | NOT_EXECUTED | Accept pages never driven through the UI; needs a second identity |
| A06 | Upload threats | ClamAV adapter, content limits, zip and DOCX checks | `clamav-scanner.test.ts`, `content-limits.test.ts`, `zip-structure.test.ts`, `docx-validation.test.ts`, `uploads.test.ts` | BLOCKED | Production scanner is unconfigured and the built-in one refuses every PDF; 8 of 10 named scenarios covered |
| A07 | Upload integrity | `uploads.ts`, quotas, reconciliation | `uploads.test.ts`, `quotas.test.ts`, `reconciliation.test.ts` | NOT_EXECUTED | Not run against the real file store; stored-version-exact check not exercised in a browser |
| A08 | Safe delivery | `documents.ts`, access tokens, preview renderer | `documents.test.ts`, `document-access-token.test.ts`, `preview-renderer.test.ts` | BLOCKED | Wrong-user and revoked-grant delivery need two identities in a browser |
| A09 | Profile history | `wallet.ts`, fact versions | `wallet.test.ts`, `protected-fields.test.ts` | NOT_EXECUTED | History tab never driven with real sign-in |
| A10 | Private notes | agency notes, `missions.ts` | `missions.test.ts`, `agency.test.ts`, `tenant-isolation.test.ts` | BLOCKED | Note privacy between agencies needs two identities |
| A11 | Requests and tasks | evidence requests, mission tasks | `missions.test.ts`, `agency.test.ts` | BLOCKED | Member-to-traveller request journey needs two identities and the agency fixture |
| A12 | Rule regression | `packs.ts`, `rule-conditions.ts`, vocabulary | `rule-conditions.test.ts`, `packs.test.ts`, `vocabulary.test.ts` | BLOCKED | Rules sign-off by an accountable person is Part 10 section 8 (owner) |
| A13 | Manual route | manual route missions | `missions.test.ts`, `packs.test.ts` | NOT_EXECUTED | Not driven through the UI |
| A14 | Snapshot minimisation | `missions.ts` snapshot scope | `missions.test.ts` (unrelated facts and documents seeded and proven excluded) | PASS | Direct automated proof, green on this commit. No UI run: noted |
| A15 | Acknowledgement | `acknowledgements.ts`, step-up | `acknowledgements.test.ts`, `step-up.test.ts` | NOT_EXECUTED | Mechanism tested; the screen was never driven with a real person |
| A16 | Post-approval change | revision counter, `submissions.ts` | `submissions.test.ts`, `acknowledgements.test.ts` | NOT_EXECUTED | Not driven through the UI |
| A17 | Alerts | `notifications.ts`, daily sweeps | `notifications.test.ts`, `notification-sweep.test.ts`, `expiry.test.ts` | NOT_EXECUTED | 6 of 11 event types covered; sweeps run daily, not hourly |
| A18 | Email provider | Resend port and signed webhook | `email.test.ts`, `resend-webhook.test.ts` | BLOCKED | No real provider account, key or webhook secret |
| A19 | AI providers | provider config and adapters | `ai-provider-config.test.ts`, `openai-extraction.test.ts`, `anthropic-extraction.test.ts`, `gemini-extraction.test.ts` | BLOCKED | No live provider configured (`aiExtraction` is unconfigured in production) |
| A20 | AI quality | quality harness | `harness.test.ts`, `scoring.test.ts`, `ai.test.ts` | BLOCKED | Needs a real model and a person who judges the output |
| A21 | AI privacy | redaction and consent gates in `ai.ts` | `ai.test.ts` | BLOCKED | Needs a real provider and the privacy reviewer |
| A22 | AI endpoints | SSRF denial list | none (deliberately not built until a custom endpoint field exists) | NOT_EXECUTED | Not implemented |
| A23 | AI resilience | fallback and budget handling | `ai.test.ts` | BLOCKED | Needs a real provider outage drill |
| A24 | AI concurrency | `runExtraction` concurrency and budget | `ai.test.ts` | NOT_EXECUTED | Unit level only; no live provider |
| A25 | Encryption | key management, per-record keys | `key-management.test.ts`, `encryption-backfill.test.ts` | BLOCKED | Master key has no rotation tool or escrow |
| A26 | Audit | hash-chained audit, `verify:audit-chain` | `audit.test.ts`, `audit-checkpoints.test.ts`, `audit-chain-report.test.ts` | NOT_EXECUTED | Not run against the production audit trail |
| A27 | Privilege | platform roles, support grants | `platform-roles.test.ts`, `support-access.test.ts`, `commercial-override.test.ts` | NOT_EXECUTED | Support-grant privilege has no admin screen |
| A28 | Commerce | plans, entitlements, manual billing | `plans.test.ts`, `entitlement-enforcement.test.ts`, `billing.test.ts` | NOT_EXECUTED | Not driven through the UI; payments are unconfigured by design |
| A29 | Privacy | export, erasure, legal hold, retention | `account-export.test.ts`, `erasure.test.ts`, `legal-hold.test.ts`, `account-retention.test.ts` | NOT_EXECUTED | Export and deletion screens need a real session; legal reviewer not appointed |
| A30 | Recovery | `docs/operations/recovery.md` | `backup-reconciliation.test.ts` | BLOCKED | Restore never rehearsed; no independent store for document originals; no key escrow |
| A31 | Deployment safety | release record, protected migration workflow | `release-record.test.ts`, `deployment-mode.test.ts` | NOT_EXECUTED | Rollback never rehearsed; migration role and environment not created |
| A32 | UX, language, accessibility | `docs/ux/critical-states.md`, whole-page scans | `a11y-pages.test.tsx`, `a11y-signed-in.test.tsx`, `a11y-forms.test.tsx`, `ux-public.spec.ts` | BLOCKED | Screen-reader pass owed to a person; Bangla deferred by the owner |
| A33 | Capacity | `packages/load` | `dataset.test.ts`, `stats.test.ts` plus the load run | NOT_EXECUTED | Measured on one machine against plain Postgres; Neon rehearsal at launch size not done |
| A34 | Public trust | `/trust`, `/trust/[packKey]` | `trust/[packKey]/page.test.tsx`, `a11y-pages.test.tsx` | NOT_EXECUTED | Live catalog is empty (no published route), so the route page was not seen live |
| A35 | Independent review | none | none | BLOCKED | Cannot be self-certified; needs an outside reviewer |

**Totals:** PASS 1, FAIL 0, BLOCKED 18, NOT_EXECUTED 16

The full automated suite was green on the verified commit (see the checkpoint document); the table above says what that does and does not prove.

**Update 2026-10-06 (Task 8, code `a27cefb`):** no row changed state. A30 and A35 remain BLOCKED (`part-10-security-scans.md`). A33 stays NOT_EXECUTED: load was re-run and met its target on one machine, but the PDF timing with a real scanner and the Neon rehearsal were not done. Final verdict: `final-report.md`.
