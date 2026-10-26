# Small Commercial V1: programme and current-state reconciliation

Owner instruction of 26 October 2026 ("Adaptive Commercial Completion and Expansion Programme"). This page is the single plan that turns the existing VisaStack into a lean commercial release for about 100 to 1,000 users (travellers, agencies, administrators). It does not replace Programme X: Programme X continues inside it (section 5). Deferred controls live in [DEFERRED-COMMERCIAL-HARDENING.md](DEFERRED-COMMERCIAL-HARDENING.md).

Rule of the programme: the current code comes first. Preserve what works, extend it, never rebuild a working system to match an older plan.

Source priority: (1) the owner's latest instruction; (2) current code and database state; (3) `CLAUDE.md`, `docs/SESSION-START.md` and the newest session handoff; (4) Programme X `STATUS.md` and `WORK-PACKAGES.md`; (5) `docs/public-beta/*`; (6) the requirements ledger and ADRs; (7) older PRDs and directives (intent only).

## 1. Current state at main `174ae1a` (26 October 2026)

Checked in code, not inferred from documents. States used: implemented, wired (reachable in the product), deployed, configured, acceptance-tested.

- Migrations: 92 in the repository, 92 applied in production (STATUS, 26 Oct), none pending.
- Open pull requests: #177 (open sign-up switch) and #77 (WorkOS staging identities, obsolete since WorkOS was retired). Both owner-held; untouched.
- Main CI and CodeQL green on `174ae1a`. The repository is public (verified through the GitHub API on 26 Oct 2026), which is why CodeQL runs; see owner action O1 in the handoff.
- Programme X: WP-A0 to WP-X3, WP-V3, WP-V4 agency slice, Home, calendar export, per-case sharing exceptions (#278) and reference codes (#279) are merged and live. Next: Prepare Again, request screens and colour polish (closing WP-V4), WP-V5, WP-V6.

### Already solid (do not rebuild)

| Area | What exists | Where |
|---|---|---|
| Sign-in | Neon Auth only (WorkOS retired, #237); step-up proof | `apps/web/src/lib/session.ts`, `packages/services/src/access/` |
| Access gate | `requireAccess` with typed proofs, default deny, uniform not-found, ratchet test against new ungated reads | `packages/services/src/access/require-access.ts`, `access/enforcement.test.ts` |
| Sharing | Grants (account or organization, all cases or one case, sections, document lists, expiry, pause, revoke), invitations, per-case exceptions, support grants | `packages/services/src/sharing.ts`, ADR 0017 |
| Record model | Immutable fact versions with status (Declared, Extracted, Confirmed, Document Supported, Agency Reviewed, Conflicted, Stale, Superseded), method, source document, evidence links, conflicts | `packages/db/src/schema.ts` (`facts`, `fact_versions`, `evidence_links`, `conflicts`) |
| Cases | Pack versions bound per case, readiness from source-backed requirements, selected evidence, snapshots, tasks, appointments, Application Memory | `packages/services/src/missions.ts`, `application-memory.ts` |
| Document intake | Durable job table with leases, quarantine, structural scan, normalisation, embedded text, MRZ (TD3), classification, then human review; triggered on upload with a daily backstop | `packages/services/src/intake.ts`, `jobs.ts`, `mrz.ts`, `extraction.ts` |
| AI providers | OpenAI, Anthropic and Gemini adapters for extraction and OCR; database-held provider settings with encrypted keys; test, evaluate, activate, roll back, emergency disable; fallback provider; budgets and caps; data-terms records; training guard (built, off by owner decision); consent per use; proposals only, a person approves | `packages/adapters/src/*-extraction.ts`, `*-ocr.ts`, `packages/services/src/ai*.ts`, `/app/admin/ai-settings` |
| Billing records | Plans, subscriptions, scheduled downgrades, entitlement enforcement (seats, invitations, cases, storage), billing accounts, invoices with manual payment recording | `packages/services/src/plans.ts`, `billing.ts`, `entitlement-enforcement.ts` |
| Exports | Full account export (sync and async), agency export behind an Export Profile grant | `packages/services/src/export.ts`, `account-export.ts` |
| Audit and events | Append-only audit trail (database rules refuse edits), product events with dedupe | `audit.ts`, `product-events.ts` |
| Storage and backup | Private R2 with private mirror, protected fields with pgcrypto, weekly encrypted database backup, isolated database restore drill passed | `docs/operations/current-platform.md` |

### Partial (exists, journey or acceptance incomplete)

| Area | Gap |
|---|---|
| Reading documents | Embedded text and MRZ run automatically. Private OCR (Tesseract) runs only inside the GitHub scanner worker, whose real run failed at install, so scanned images get no text on the normal path. AI reading needs the person to press "Read Text from This Scan" and then "Read Details from This Document". |
| Malware scanning | Every upload passes the structural scan; ClamAV adapters exist (`clamav`, `github_clamav`) but none is accepted in production; readiness reports scanning unconfigured. |
| Prepare Again | Sharing questions and answers (`listCaseSharingQuestions`, `applyCaseSharingAnswers`) are built but not called; no reuse flow exists. |
| Payments | `PaymentPort` is a stub (`NullPaymentPort`); readiness reports payments unconfigured; invoices record cash manually only. |
| Staff two-step sign-in, recovery | Staff MFA acceptance open; document, key and full lifecycle recovery unverified; key has no verified rotation or escrow. |
| Real data | Gate exists (`DEPLOYMENT_MODE`, `realApplicantData`), currently disabled. |

### Missing (must be built in this programme)

1. Prepare Again (Programme X U02).
2. Request screens and colour polish (closing WP-V4).
3. Selected-output projection and four outputs (WP-V5), built so the AI context composer uses the same engine.
4. Automatic document reading after upload (OCR and extraction proposals without button presses, where consent and configuration allow).
5. Hosted payment through a Bangladesh gateway behind `PaymentPort`, with server validation, and an "I Paid Another Way" claim the admin verifies.
6. VisaStack AI Context Gateway: read-only, standards-based remote connector (MCP), AI connection grants with scopes and duration, context composer with provenance, AI Connections page, audit.
7. Commercial-minimum acceptance with synthetic accounts.

### Conflicts found

| Conflict | Resolution |
|---|---|
| `SESSION-START.md` section 6 parks payments, "Stripe first, then a Bangladesh gateway" | Owner's 26 Oct instruction starts payments with a Bangladesh hosted gateway (SSLCOMMERZ or equivalent) behind the provider port. Newer wins. |
| `CURRENT-STATE.md` (12 Oct row) says private-worker OCR is implemented | True in code, but the worker is not accepted, so production has no private OCR path today. |
| `CURRENT-STATE.md` 26 Oct update says 90 migrations | 92 since #278 and #279. |
| `docs/roadmap/remaining-commercial-blockers.md` lists WorkOS gates | WorkOS retired (#237); the live gate list in `apps/web/src/lib/commercial-readiness.ts` is authoritative. |
| Readiness counts malware scanning only for `clamav` with a socket | `github_clamav` can never report available even if accepted; reconcile when the scanner package lands. |
| Fact status `STALE` has no writer | Readiness and Prepare Again treat it correctly if set; nothing sets it yet. Recorded, not changed. |
| WP-V5 "AI context" output and the new AI gateway context composer | One projection engine: WP-V5 builds it, the gateway reuses it (owner instruction section 27). |
| `CLAUDE.md` says every Programme X PR needs the owner's merge word | Narrowed for WP-V4 by the owner on 26 Oct (auto-merge when correctly ready). Final release candidate still needs the owner. |

## 2. Commercial requirement classes

- **Commercial-minimum**: needed before real travellers and agencies use VisaStack commercially. Basic protection for passports, financial evidence and cross-agency data is never deferred: HTTPS, private storage, existing encryption, access control and tenant isolation, revocable sharing, audit, basic backup (database and documents), protected secrets, safe download, privileged-account safeguards, real malware scanning on uploads.
- **Scale and hardening**: preserved in the architecture, deferred until adoption, risk, regulation or sales justify them. Each item, its trigger and its seam: [DEFERRED-COMMERCIAL-HARDENING.md](DEFERRED-COMMERCIAL-HARDENING.md).

## 3. Execution order from main

Superseded the same day by the architecture freeze: the authoritative order, package contracts and owner actions are in [SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md](SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md) section M. The table below is the first draft, kept for history.


One concern per pull request. Each runs the repository's full verification and reviews before merge.

| Step | Package | Phase | Migration | Owner gate |
|---|---|---|---|---|
| 1 | Prepare Again (WP-V4 U02) and this plan | A, B | none | none: the owner allowed WP-V4 PRs to merge when correctly ready (26 Oct, `docs/SESSION-START.md` section 6, conflict register CR15) |
| 2 | Request screens and colour polish, closing WP-V4 | B | none expected | none (CR15) |
| 3 | Malware scanner worker fix and readiness reconciliation | D | none | Actions variables already set by owner |
| 4 | Automatic document reading (OCR and extraction proposals run after upload when consent and a provider allow; plain "We Found These Details" review; manual retry kept) | C | none expected | none |
| 5 | WP-V5 selected-output projection and four outputs | G (engine) | maybe | output label wording; merge word (D6) |
| 6 | Payments: SSLCOMMERZ adapter behind `PaymentPort`, payment attempts, validated server callback, idempotent recording, "I Paid Another Way" claims | E | yes | migration run; merchant credentials; pricing unchanged |
| 7 | AI Context Gateway: connection grants, authorisation server for AI clients, read-only connector tools, AI Connections page, audit | F | yes | migration run; permission semantics already set by the 26 Oct instruction |
| 8 | Commercial-minimum acceptance with synthetic accounts (WP-V6 merged into this) | H | none | final release candidate merge |
| 9 | Release gaps needing owner or provider action | I | none | owner |
| 10 | Real commercial users | J | none | owner |

Feature freeze: after steps 1 to 8, only P0/P1 defects, observed friction, security corrections, direct commercial blockers and usage-backed improvements.

## 4. Owner gates (only these stop work)

Production migration runs, real applicant data on, payment merchant credentials and activation, pricing changes, provider-data policy changes (training guard on), production AI provider activation, major permission semantics beyond the 26 Oct instruction, the final release merge, destructive data operations.

## 5. Programme X inside this plan

Programme X keeps its packages and allowlists. Steps 1, 2, 5 and 8 above are WP-V4, WP-V5 and WP-V6. Files a step needs beyond its package allowlist are added to that allowlist with a dated reason line citing the owner's 26 Oct instruction.

## 6. Scaling and cost triggers (measure first)

| Signal | Trigger | Action to evaluate |
|---|---|---|
| Intake queue | Jobs waiting over 15 minutes at the daily peak for 3 days | Enable the optional five-minute Worker trigger, then a dedicated worker |
| Database | Connection errors or p95 query over 500 ms for a week | Raise Neon compute; add indexes found by slow-query log |
| Storage | R2 over 50 GB | Review storage class and retention |
| AI spend | Monthly AI cost over 60 percent of the configured hard limit | Review per-document caps, provider and model choice |
| Connector traffic | Over 10,000 connector calls a day | Rate limits per connection, caching of composed context |
| Payments | Over 200 invoices a month | Consider recurring billing and a second provider |

Costs are recorded in [the provider cost register](../public-beta/PROVIDER-COST-REGISTER.md); unavailable readings stay unavailable, never zero.
