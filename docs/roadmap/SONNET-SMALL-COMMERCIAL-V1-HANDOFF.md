# Small Commercial V1: implementation handoff (execute in order)

Written 26 October 2026 by the architecture session. It is the main instruction for the implementation sessions that follow. Instruction to the next session: **read this file, then execute the packages in section M in order.** Each package is one pull request unless it says otherwise.

Authority: the owner's 26 October 2026 instructions, which set the Small Commercial V1 target of 100 to 1,000 users and froze the architecture. This file, ADRs 0019 to 0021 and [DEFERRED-COMMERCIAL-HARDENING.md](DEFERRED-COMMERCIAL-HARDENING.md) supersede older plans where they conflict. `CLAUDE.md`, `docs/SESSION-START.md` and the Programme X files still govern **how** work runs: branches, allowlists, reviews, full check, CI, merge and reporting.

## A. Verified current state (26 October 2026)

| Fact | Value | How verified |
|---|---|---|
| main | `174ae1a` (#280, docs). Last code merges: #279 reference codes, #278 per-case sharing exceptions | `git log origin/main` |
| CI on main | CI and CodeQL green on `174ae1a` | Actions runs 40322617186, 40322617206 |
| Repository visibility | **Public** (`"private": false`). `CLAUDE.md` says private; that statement is wrong | GitHub API |
| Migrations | 92 in repo, 92 applied in production, none pending | Programme STATUS; journal |
| Open PRs | #177 (open sign-up switch), #77 (WorkOS staging; obsolete). Both are owner-held: do not touch | GitHub |
| Work branch | `ccr-847e092e-iee1pl` (pushed, **no PR yet**): Prepare Again, Small Commercial V1 plan, this handoff, ADRs 0019 to 0021 | This session |
| Sign-in | Neon Auth (managed Better Auth) only. No MFA available on the managed service | Code, Neon docs |
| Data and files | Neon Postgres (drizzle); private R2 plus a private Vercel Blob mirror | `current-platform.md` |
| Mail | Resend (application), Neon Auth SMTP (sign-in) | Same |
| Documents | Durable intake jobs: quarantine, structural scan, normalise, embedded text and MRZ, then review. Private OCR (Tesseract) exists **only** in the GitHub scanner worker, which is not accepted. AI OCR and AI extraction are manual buttons. AI OCR text is not fed to extraction. MRZ creates no field suggestions | ADR 0019 context |
| AI providers | OpenAI, Anthropic and Gemini adapters. Encrypted keys in the database; test, evaluate, activate, roll back, emergency stop, fallback; budgets and caps; data-terms records; training guard built and **off** (owner decision 25 Oct); consent per use; proposals only | `/app/admin/ai-settings` |
| Payments | Plans, subscriptions, entitlements, billing accounts and organization invoices exist, with manual admin recording and no ledger. `PaymentPort` is a stub. Agencies cannot see invoices | ADR 0020 context |
| Sharing and access | `requireAccess` gate with typed proofs. Grants are for an account or organization, cover all cases or one, with sections, documents, expiry, pause and revoke. Per-case exceptions; invitations; support grants. 313 older functions sit in the ratchet baseline; every web caller was checked (H20) | Audit this session |
| Step-up | Neon session recency check (5 minutes) before every privileged action. Services take a boolean, but every web caller verifies first (H21) | Audit this session |
| Staff protection | `/app/admin` requires a platform role. No second factor anywhere | Audit this session |
| Applicant Truth | Immutable fact versions with status and provenance; acknowledgements invalidated by material change; snapshots | Schema |
| Checklists (packs) | One published checklist in production: "UK Visitor1", 2 requirements, not authoritative, review overdue since 23 Oct, used by no case. Manual mode exists for cases without one | Read-only production query |
| Real data | Disabled (`controlled_pilot`); readiness reports `realApplicantData` disabled, `malwareScanning` and `payments` unconfigured | Readiness, code |
| Programme X | WP-A0 to WP-X3, WP-V3, WP-V4 agency, Home and Needs Attention, calendar export, per-case exceptions and reference codes are live. Remaining: Prepare Again (built on branch), request screens and colour (WP-V4), WP-V5, WP-V6 | STATUS, code |

Security gaps found this session, all scheduled before real data:

- the AI reading entry points do not bind the document version to the applicant (M12);
- two admin reads are open to any platform role (M13);
- the support-grant service has no role check (M14);
- staff have no second factor (M08).

## B. Do not touch (working, keep as is)

- The access gate, its proof types and the ratchet. The baseline may only shrink.
- `grants`, per-case exceptions (ADR 0017) and the sharing lock order: sharing lock before the audit lock.
- Immutable fact versions, evidence links, conflicts, acknowledgement invalidation and snapshots.
- The intake state machine, `processing_jobs` leases and idempotency keys, quarantine and the structural scanner.
- The AI provider settings, budgets, kill switch, fallback, data terms, training guard and consent switches. Extend them; never bypass them.
- Reference codes (ADR 0018), the calendar core, Needs Attention (ADR 0016) and the agency Do Next list (ADR 0015).
- `exportAccount` (the full-account export). Never filter it to make a brief.
- Plans, entitlements, billing account transitions and `recordInvoicePayment` behaviour (ADR 0020 adds a ledger beneath it, behaviour-neutral).
- Programme X allowlists and the guard tests (title case, vocabulary, accessibility forms, no em dash).
- Owner-held PRs #177 and #77.

## C. Small Commercial V1 cutline

**Must exist before the first real commercial users:**

1. Commercial-minimum controls M01 to M17 closed (register part 1).
2. Programme X: Prepare Again, the request screens (U07 request UX), and the WP-V5 selected-output engine plus the agency brief and the confirmed-information sheet.
3. Automatic document reading per ADR 0019, with the "We Found These Details" review.
4. Invoice payment per ADR 0020: SSLCOMMERZ online for BDT, plus "I Paid Another Way" with admin confirmation.
5. AI Context Gateway per ADR 0021: read-only, five tools, AI Connections screens, audit.
6. One or two maintained, reviewed launch checklists (section J). Manual mode for everything else.
7. Commercial acceptance (section K) passed on the exact release commit.

**May follow after the first paid users:**

- WP-V4 colour polish beyond the request screens;
- WP-V5 trip essentials output and the WhatsApp prepared message;
- automatic billing reactivation after payment;
- payment receipt upload;
- agency-side AI connectors;
- more checklists;
- H20 and H21 consolidation.

**Do not build yet:** everything in register part 2 without a met trigger, and in particular:

- write tools for AI;
- original files through AI;
- DCR;
- recurring billing;
- a second payment provider;
- a chat window inside VisaStack;
- Bangla;
- new country coverage;
- Tesseract in the Vercel function;
- redaction.

**Feature freeze:** after S17, only defects, observed friction, security corrections, commercial blockers and usage-backed improvements.

## D. Deferred hardening

See [DEFERRED-COMMERCIAL-HARDENING.md](DEFERRED-COMMERCIAL-HARDENING.md): part 1 (commercial-minimum, with the package that closes each) and part 2 (H01 to H28 with triggers and seams).

## E. Programme X continuation

- Programme X stays the experience programme. S1, S7, S8, S9 and S17 are its WP-V4, WP-V5 and WP-V6 work. Keep using its allowlists: add files with a dated reason line citing the owner's 26 Oct 2026 instruction, as done for Prepare Again.
- Merge rule (conflict register CR15): WP-V4 PRs merge when correctly ready. Every other package needs the owner's merge word unless the owner extends CR15. WP-V6/S17 always needs it.
- WP-V6 is merged into S17 (commercial acceptance). The landing "Prepared again, faster" float and card 1 text return only when S1 is live and verified (WP-V6 step 3).

## F. Document reading work packages (ADR 0019)

### S5. Automatic reading

**Objective:** reading happens after upload without a button, cheapest and most private reader first.

**Depends on:** S2 (binding fix). Benefits from S4 (private OCR in the worker), but does not require it.

**Files, likely:**

- `packages/services/src/intake.ts`, `ai.ts`, `ocr.ts`, `mrz.ts`, `jobs.ts`, `access/principal.ts` (new `SystemJob` `process-ai-reading`);
- `apps/web/src/app/api/jobs/` (new route `process-ai-reading` with `rejectUnauthorizedCron`), `apps/web/vercel.json` (daily backstop cron), `apps/web/src/lib/jobs.ts` (trigger after intake);
- tests next to each.

**Behaviour:**

1. MRZ results become field suggestions through a zero-cost run with model version `deterministic:mrz-td3/1`. Fields: surname, given names, passport number, nationality, date of birth, sex, expiry, issuing country. Valid check digits allow the "clear details" bulk accept, still with one confirmation. Use the existing field keys; ask before adding catalogue keys (see `docs/product/master-profile-enrichment/HANDOFF.md` claimed areas).
2. Intake completion enqueues one `ai-reading` job when any AI step could run. The idempotency key is the version id plus the reader version.
3. The job runs under `SystemScope<'process-ai-reading'>`. It derives the owner from the version. It checks `AI_OCR` and `AI_EXTRACTION` consent for that owner, the kill switch, budget, active provider and document protection switches.
4. Order: AI OCR only if no usable text exists and the file is an image or scanned PDF. Then AI extraction over the best text: extraction runs first, then OCR runs.
5. `getLatestExtractedText`, or its gated replacement, falls back to the latest successful `ocr_runs` text and records which source it used.
6. Cost and AI-usage reports exclude `deterministic:` runs.

**Do not:**

- add Tesseract to Vercel;
- change budgets or consent semantics;
- write facts without approval;
- remove the manual buttons (they become "Read Again").

**Security invariants:**

- The job acts only as the version's owner, with that owner's consent.
- A revoked consent stops queued jobs at run time.
- No document text appears in logs or audit records.

**Tests:**

- An MRZ passport produces suggestions with zero AI calls.
- No consent means no AI call and a pending offer.
- With consent, a scanned image gets OCR, then extraction.
- The kill switch stops the job.
- Budget exhaustion gives a clear "could not read" state.
- Duplicate enqueue runs once.
- A version from another applicant is refused.
- Cost reports exclude deterministic runs.

**Migration:** none expected.

**Owner gate:** none.

**Done when:** a synthetic passport upload shows suggestions with no button, and the tests above pass.

### S6. Reading screen states

**Objective:** the document page and review use the states in ADR 0019.

**Behaviour:**

- The ADR 0019 states: Checking the File, Reading the File, We Found These Details, We Could Not Read This One, Needs Attention.
- One consent offer when AI reading is off.
- "Read Again" as the retry.
- The source of each suggestion in plain words: machine-readable lines, read from the document, read with AI.

**Files:** `apps/web/src/app/app/applicant/[id]/documents/page.tsx`, `ai-review.tsx`, `packages/i18n/src/messages.ts`; title-case, vocabulary and accessibility tests.

**Reviews:** design accessibility review and UX copy.

**Done when:** the screens match, and guard tests and the browser checks pass.

## G. Payment work packages (ADR 0020)

### S10. Cash ledger and one recording function

**Objective:** add `invoice_payments` and `applyInvoiceCollection`, with `recordInvoicePayment` delegating to it. Behaviour-neutral except that it now refuses a currency mismatch.

**Steps:**

1. Write characterization tests for today's `recordInvoicePayment` first.
2. Make the new code tolerate a missing table.

**Migration:** yes. Build it together with the S11 tables in one migration if S11 follows directly; otherwise keep it separate. Never run it without the owner's word.

**Tests:**

- unique keys block double recording;
- the outstanding-balance check holds under concurrency (two transactions);
- VOID is refused;
- currency mismatch is refused.

### S11. SSLCOMMERZ adapter, attempts, IPN, return, reconciliation

**Objective:** the online flow in ADR 0020, exactly.

**First step:** read the official SSLCOMMERZ v4 documentation (session API, IPN, Order Validation API, Transaction Query API, `verify_sign`, `risk_level`) and record any differences from ADR 0020 in the PR.

**Files:**

- `packages/services/src/ports.ts`;
- `packages/adapters/src/payment.ts` (new `SslcommerzPaymentPort`);
- `packages/services/src/payments.ts` (new);
- `apps/web/src/app/api/payments/sslcommerz/{ipn,return}/route.ts`;
- `apps/web/src/app/api/jobs/process-payment-reconciliation/route.ts`;
- `apps/web/src/lib/providers.ts`, `capabilities.ts`.

**Do not:**

- trust the browser redirect;
- log store credentials or raw payloads (store only the normalized fields);
- add refunds or recurring billing.

**Tests:** every invariant listed in ADR 0020, against a fake provider.

**Owner gate:** sandbox credentials to test live; production credentials and the live switch.

**Reviews:** max code review and security review.

### S12. Agency invoices and "I Paid Another Way"

**Objective:**

- An agency Invoices page in the existing Usage and Billing area, with Pay Online and I Paid Another Way, for owners and admins only.
- The manual claim form.
- An admin review queue in `/app/admin/organizations/[orgId]` to approve with step-up or reject with a reason.
- Plain states: Open, Payment Started, Payment Reported (Waiting for Confirmation), Paid, Payment Needs a Check.

**Tests:**

- a non-admin member cannot pay or claim;
- approval records once;
- a claim on a paid invoice is refused with a clear message.

## H. AI Context Gateway work packages (ADR 0021)

### S8. Selected-output engine (WP-V5 core)

**Objective:** `packages/services/src/selected-output.ts`, providing:

- the `Selection` type;
- `buildSelectedOutput(proof, selection, options)`;
- `renderAiContext(output)`;
- the provenance value shape and filtering rules exactly as in ADR 0021 section 4.

**Reuse:**

- the catalogue layers, kinds and protection floors (`packages/core/src/catalogue`);
- `isFactStatusEligible`, `computeReadiness`, `listNeedsAttention` and reference codes;
- the document protection switches.

**Do not:**

- call `exportAccount`;
- read agency notes or tasks;
- return storage keys or URLs.

**Tests:**

- an unselected layer is absent from the server output;
- conflicted values become markers;
- superseded values are absent;
- identifiers are masked by default;
- restricted kinds follow the rules;
- the case requirement keys drive `required_by_case`;
- output for one case is measurably smaller than the full account export, recorded in the PR.

**Allowlist:** WP-V5 already lists `selected-output.ts`.

### S9. WP-V5 outputs

**Objective:** the agency brief and handover, and the confirmed-information sheet, on S8 with `SelectedScopeSummary` preview. Trip essentials and the WhatsApp message may follow (cutline).

**Also:** the first-run choice "Prepare a Brief".

**Owner gate:** output label wording (WP-V5).

**Acceptance:** WP-V5 acceptance in `WORK-PACKAGES.md`.

### S13. Authorization server for AI apps

**Objective:** the discovery documents, `/oauth/authorize` (consent page), `/oauth/token`, `/oauth/revoke`, the CIMD fetcher with SSRF rules and the allowlist, and the token store. All as ADR 0021 section 2.

**First step:** read the current official OpenAI MCP authentication page and Claude's connector authentication page. Record ChatGPT's exact redirect URIs and its CIMD host, then fill the allowlist constant.

**Migration:** yes (`ai_connections`, `ai_connection_tokens`).

**Tests:**

- PKCE required (plain refused);
- a wrong `resource` is refused;
- an unknown client host is refused;
- a redirect not in the client document is refused, except loopback with any port;
- a code works once, within 60 s;
- refresh rotation, with reuse revoking the family;
- revoke works immediately;
- the `iss` parameter is present;
- a form-encoded body is accepted;
- the SSRF fetcher refuses private addresses, redirects and oversize responses.

**Reviews:** max code review and security review.

**Owner gate:** the migration run.

### S14. MCP route and tools

**Objective:**

- `apps/web/src/app/mcp/route.ts`: stateless Streamable HTTP through the official SDK, pinned.
- `withAiConnection` as the only data path.
- The five tools in ADR 0021 section 6, with annotations and output schemas.
- 401 with `resource_metadata` and `scope`.
- Rate limits and size caps.

**Guard test:** no tool reads data outside `withAiConnection`.

**Tests:** the AI-context acceptance list in section K. Also test the real flow with Claude (custom connector) and ChatGPT (developer mode) against a synthetic account, and record the results.

### S15. AI Connections screens

**Objective:**

- The consent page fields and defaults (ADR 0021 section 5).
- A Sharing-area section "AI Connections" listing each connection: app name, connected date, access in plain words, case, Full Document Numbers yes/no, expires, last used, Change Access, Turn Off.
- Turn Off revokes immediately.

**Words:** no "OAuth", "MCP", "token" or "scope" anywhere visible.

**Reviews:** accessibility review and UX copy.

### S16. AI access audit and telemetry

**Objective:** the audit events and product events in ADR 0021 section 7, plus an admin count of connections and context calls.

**Tests:** no value, task text, document text or token ever appears in audit metadata or logs.

## I. Access and security work packages (only what is needed now)

### S2. Security minimum (M12, M13, M14)

1. **M12, the AI reading entry points.** `runExtraction`, `runOcr`, `runInconsistencyCheck`, `renderOcrSourceImage` and `getLatestExtractedText` prove the version belongs to the applicant: join version → document → applicant, as `suggestDocumentKind` does, or take a document proof from `requireAccess`. A mismatch returns `not_found` (uniform with missing). The ratchet adds `document_version_id` to its owned columns; baseline entries that this newly catches are listed in the PR and may only shrink later. Tests: a valid version of another applicant is refused in each entry point, and a cache hit cannot copy another applicant's proposals.
2. **M13, admin reads.** `listAllApplicants` and `listRecentAuditEvents` require a specific platform permission (privacy or security admin), inside the service. The pages show "Not available for your role" otherwise.
3. **M14, support grants.** `createSupportGrant` checks the approver's platform permission inside the service.

**Reviews:** max code review and security review.

**Migration:** none.

### S3. Staff second factor (M08)

**Objective:** authenticator-app codes (TOTP, RFC 6238) for every account holding a platform role.

**Behaviour:**

- **Enrolment:** on first `/app/admin` visit, using a QR code and 10 single-use recovery codes. Codes are stored hashed; the secret is envelope-encrypted with the existing key port.
- **Every privileged action:** the step-up check requires a code within the 5-minute window in addition to the recent sign-in.
- **`ADMIN_EMAILS` bootstrap:** it still applies only while the roles table is empty, and must enrol.
- **Lost device:** a recovery code; otherwise the platform owner resets another admin's factor with step-up, audited. The owner's own reset is a documented manual procedure.

**Migration:** yes (`staff_second_factors`).

**Owner gate:** the migration run, and the owner enrolling.

**Note:** passkeys are H06.

### S4. Real malware scanning (M06)

**Objective:** make the existing GitHub ClamAV worker install and run, and let readiness recognise it.

**Behaviour:**

- Fix the install: `clamdscan` was omitted by `--no-install-recommends`, or use `clamscan` directly.
- Run `verify-synthetic` (owner action O4 if the session cannot dispatch workflows).
- Readiness reports `malwareScanning: available` for `github_clamav` only when a recent successful verification is recorded (use the existing evidence pattern, not a hard-coded true).
- The documents page says reading may take a few minutes.

**Owner gate:** O4 (switch `MALWARE_SCANNER_PROVIDER` in Vercel; Actions variables already set).

**Note:** this also turns on private OCR (ADR 0019).

## J. Launch checklist (corridor) content

**Requirement:** one or two **maintained** checklists before launch, chosen by the owner for the routes the first agencies actually file (O7).

Each must:

- be `authoritative`, with a distinct author and reviewer (RUL-02 is enforced);
- cite official sources per requirement;
- set the next review within 30 days;
- be published through Pack Studio.

Rules for the rest:

- Every other route runs in manual mode, and a case without a maintained checklist never shows an automated readiness claim. S17 verifies this on the screen.
- The test checklist "UK Visitor1" is withdrawn or replaced (owner decides).
- Sessions do not write rule content from memory: content needs sources and a human reviewer.

## K. Commercial acceptance (S17, merged with WP-V6)

Run on the exact release commit, against isolated synthetic accounts, with results in `docs/upgrades/programme/COVERAGE-LEDGER.csv` and known-issues. **Must pass:**

- **Traveller:** sign up and confirm; create the reusable record; upload a passport (suggestions appear with no button) and a scanned bank statement; review and confirm; expiry and Needs Attention show it; create a case on a maintained checklist; share with an agency; answer an agency request.
- **Agency:** create the organization; invite a team member and a client by email; open a case; request evidence; receive the response; review it; triage and Do Next; readiness or output (brief); close the case.
- **Reuse:** Prepare Again from a finished case. Valid records are reused, a stale document is marked for review, and nothing inherited: no approval, acknowledgement, grants, notes or outcome. An unticked all-cases agency cannot see the new case.
- **Payment:** sandbox invoice paid online; IPN validated; cash recorded once; a spoofed return records nothing; a duplicate IPN is a no-op; a wrong amount is held.
- **Payment fallback:** a manual claim is approved by an admin and recorded once; a second recording of the same balance is refused.
- **AI connection:**
  - connect Claude and ChatGPT to a synthetic account with Case A only and Money off;
  - ask for help on Case A; the context is compact and carries provenance;
  - Case B is refused;
  - no money fields appear in any server response;
  - with Document List on and Text off, `get_document_text` is refused;
  - the grant expires and the next call is denied;
  - turning it off denies the next call;
  - Agency A's notes never appear;
  - the context for one case is smaller than the full export (bytes recorded).
- **Security:**
  - Agency A cannot reach Agency B (existing suites plus one live check);
  - expired and revoked grants fail;
  - original files are never downloadable without the permission;
  - an EICAR test file is quarantined and never becomes readable;
  - a malformed PDF ends in Needs Attention;
  - staff actions require the second factor;
  - the M12 to M14 tests pass.
- **Recovery:** one document restored from the mirror into an isolated location; the database restore drill re-run; the Neon point-in-time window recorded.
- **Gates:** readiness shows `malwareScanning: available`, `payments: available` (sandbox, then live), `aiConnector` as configured, and `realApplicantData` still disabled until the owner switches it.

**Accepted deferred risk:** register part 2.

**Owner configuration:** section L.

**Post-launch:** register part 2 triggers.

## L. Owner-only actions (sessions must not do these)

| # | Action | Needed before |
|---|---|---|
| O1 | Decide repository visibility. Recommended: make it private while the product is proprietary. Consequences: CodeQL then needs GitHub Advanced Security or stops, Actions minutes become metered (the scanner worker uses them) and `CLAUDE.md`'s CodeQL line becomes true. Separately, run a full-history secret scan (GitHub secret scanning) | Before more architecture lands publicly; at the latest before real data |
| O2 | Approve this cutline, ADRs 0019 to 0021 and the register (or change them) | S5 onward |
| O3 | Confirm the Vercel plan allows commercial use (Pro, not Hobby) and the Neon plan's limits and point-in-time window | Real data, payments |
| O4 | Switch `MALWARE_SCANNER_PROVIDER=github_clamav` in Vercel after S4, and run or allow `verify-synthetic` | S4 acceptance |
| O5 | Keep an offline copy of the application master key (M07), stored as the runbook says | Real data |
| O6 | SSLCOMMERZ merchant account: sandbox credentials, then live; set the IPN URL in its panel; confirm fees and pricing (prices unchanged unless decided) | S11 testing, then live |
| O7 | Choose one or two launch routes and supply a qualified reviewer for their checklists | Launch |
| O8 | The word for each production migration (S3, S10 and S11, S13) | After each merge |
| O9 | Choose the production AI provider and its terms; keep or change the training guard (H14); enable the AI connector for real users | Real data, connector launch |
| O10 | Legal review: privacy notice and terms updates for automatic AI reading, the AI connector and the payment processor | Real data, payments |
| O11 | Switch real applicant data on (`DEPLOYMENT_MODE`), after S17 | Launch |
| O12 | The final release decision (S17 PR) | Launch |

## M. Execution order

One package per session where possible. Always: preflight, the Programme X allowlist, targeted tests, `/code-review` (max for auth, documents, sharing, payments, AI access) and `/security-review` where relevant, one full check, a draft PR, CI green on the exact head, merge per the rules, then the plain-language report. Generate a migration only after the previous migration is on main.

| Order | Package | Migration | Owner gate | Merge rule |
|---|---|---|---|---|
| 1 | **S1. Ship Prepare Again.** Branch `ccr-847e092e-iee1pl` holds it with this session's docs. Done there: service, screen, 13 service tests, web tests, accessibility scan, max code review (12 fixes), security review (no findings), two mutations red. Remaining: a full check (`scripts/agent/full-check.sh`), the draft PR, CI, merge, live check, report | none | none | CR15 (WP-V4) |
| 2 | S2. Security minimum (M12 to M14) | none | none | owner word |
| 3 | S3. Staff second factor (M08) | yes | O8 | owner word |
| 4 | S4. Real malware scanning (M06) | none | O4 | owner word |
| 5 | S5. Automatic reading (ADR 0019) | none expected | none | owner word |
| 6 | S6. Reading screen states | none | none | owner word |
| 7 | S7. WP-V4 close: request screens (U07, spec B09) and the colour polish they touch | none | none | CR15 |
| 8 | S8. Selected-output engine (WP-V5 core, ADR 0021 section 4) | none | none | D6 |
| 9 | S9. WP-V5 outputs: brief and confirmed sheet | maybe | label wording | D6 |
| 10 | S10. Cash ledger and recording function | yes | O8 | owner word |
| 11 | S11. SSLCOMMERZ online flow | yes, with S10 if adjacent | O6, O8 | owner word |
| 12 | S12. Agency invoices and manual claims | none | none | owner word |
| 13 | S13. Authorization server for AI apps | yes | O8 | owner word |
| 14 | S14. MCP route and tools | none | none | owner word |
| 15 | S15. AI Connections screens | none | none | owner word |
| 16 | S16. AI audit and telemetry | none | none | owner word |
| 17 | S17. Commercial acceptance and release reconciliation (WP-V6) | none | O3, O5, O7, O9 to O12 | owner word (never automatic) |

Running alongside, never ahead (owner, 25 Oct): the engineering roadmap steps 4 and 5 are now H20 and H21 in the register, with triggers. Steps 6 to 10 stay proposals for the owner (step 6's MFA item is S3 here).

## N. Cost and capacity envelope (100 to 1,000 users)

The current architecture is enough, with no structural change, until a trigger below fires. These are configuration or plan steps, not rebuilds.

| Resource | Expectation | Trigger to act |
|---|---|---|
| Vercel | Serverless pages, jobs and the connector fit one project | Plan limits or function duration errors; commercial use needs a paid plan (O3) |
| Neon | Hundreds to low thousands of cases and documents fit a small compute | Connection errors or p95 query over 500 ms for a week; storage over the plan; measure during pilot |
| R2 plus mirror | A few GB at this scale | Over 50 GB: review storage class and retention |
| Resend | Low volume | Daily send cap reached on the current plan |
| AI reading | Cost per document recorded in `ai_extraction_runs` and `ocr_runs`; MRZ and private OCR are free | Monthly AI cost over 60 percent of the configured hard limit |
| Scanner and OCR worker | Batches on GitHub Actions | Upload-to-readable over 10 minutes at peak for 3 days, or Actions minutes over 70 percent (H11) |
| Payments | Per-transaction gateway fee (confirm with SSLCOMMERZ, O6) | Over 200 invoices a month (H16) |
| AI connector | Each call is a few database queries and no AI cost to VisaStack | Over 10,000 calls a day: cache composed context per connection and case |

## O. Notes for the implementing sessions

- `CLAUDE.md` section 6 says CodeQL is skipped on a private repository. Today the repository is public and CodeQL runs: report CodeQL as run. If the owner makes it private (O1), it becomes skipped again.
- `docs/roadmap/remaining-commercial-blockers.md` lists WorkOS gates. The live gate list is `apps/web/src/lib/commercial-readiness.ts`, and this handoff supersedes that file's plan.
- Neon Auth's managed service supports no plugins of VisaStack's choosing: no MFA, no OAuth provider. That is why S3 and S13 are built in the app.
- Every new public route must keep the per-request security policy and must never echo provider payloads, tokens or secrets.
