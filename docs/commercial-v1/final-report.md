# VISAStack COMMERCIAL V1 - FINAL IMPLEMENTATION VERDICT

Written 2026-10-06 (Task 8, directive Part 10 section 18). Every figure below comes from a file in this folder or a live check made today. Nothing was merged, deployed, enabled, flipped or activated by this session.

## VERDICT

- **CODE COMPLETE - COMMERCIAL LAUNCH BLOCKED**

Why this verdict and not the other two: the full automated suite is green on the exact commit that production runs (2,759 passed, 0 failed), so the software is not "implementation incomplete". It is not "release eligible" because 0 of 18 required approvals and proofs exist (`release-gate.md`): no outside security review, no restore rehearsal, no published rules, no live scanner, email or AI provider, no named incident owner, no legal approval, no price. Words such as "ready" or "production grade" are not used because no gate evidence supports them.

## RELEASE CANDIDATE

- Branch: `claude/pensive-cray-4fhand` (documentation only on top of main; PR is a draft and is not merged)
- Tested code SHA: `a27cefb8bd40e0f766870309b02a848c1917307d` (main after PR 172), then re-run on the branch head `3fbaeef143e33ca039ff353c9212f70fd9d3b165` after the test-tool upgrade (no shipped source file differs)
- Deployed verification: production, deployment `dpl_EBYqheEpDEEdNmvSSsSbCn4mDtxV`, same SHA as tested; `/api/health/ready` returned ready on 2026-10-06 in controlled_pilot mode. This is the pilot environment with made-up data. **No isolated staging environment exists**, so the directive's staging deploy was not done.

## P0 REQUIREMENTS

- Total: 75 (ledger rows with a requirement id)
- Verified to the Part 10 bar: 0
- Ledger states as recorded: DONE 10, IMPLEMENTED_UNVERIFIED 3, PARTIAL 2, IN_PROGRESS 59, BLOCKED 1. "DONE" means code and tests exist, not that gate evidence exists
- Failed: 0
- Not executed to release standard: 75 (nothing has the outside evidence the directive requires)

## CUSTOMER JOURNEYS

None was executed through the real interface. No real sign-in is possible from the build sandbox and the staging test identities do not exist.

- J01 Independent traveller: BLOCKED. No staging sign-in secrets confirmed in the repository; the staging job was skipped on the last main run
- J02 Agency onboarding: BLOCKED. Needs a traveller identity and a platform administrator identity
- J03 Agency invites traveller: BLOCKED. Needs the agency identity and a separate invited identity
- J04 Repeat case: BLOCKED. Needs sign-in
- J05 Expiry replacement: BLOCKED. Needs sign-in and the scanner (production scanner is unconfigured)
- J06 Sharing: BLOCKED. Needs the second identity (tests 1 to 3 in the cross-account block)
- J07 Agency preparation and readiness: BLOCKED. Needs the agency fixture and two identities
- J08 Applicant truth: BLOCKED. Needs sign-in and step-up with a real person
- J09 Outcome and feedback: BLOCKED. Needs sign-in
- J10 Change agency: BLOCKED. Needs two agency identities (Agency A and B)
- J11 Family or sponsor contributor: BLOCKED. Needs a separate contributor identity
- J12 Owner operations: BLOCKED. Needs a platform administrator identity
- J13 Public trust: BLOCKED. Executed in part: the live catalog loaded (HTTP 200, one top heading, no routes published)
- J14 Export and exit: BLOCKED. Needs sign-in
- J15 AI administrator provider change: BLOCKED. Needs an administrator identity and a live provider

## ACCEPTANCE TESTS

Totals: PASS 1, FAIL 0, BLOCKED 18, NOT_EXECUTED 16. A service test never upgrades a row.

- A01 Identity and MFA: BLOCKED. No real sign-in here
- A02 Revocation: BLOCKED. Pause, revoke and resume through the UI need two identities (test written, skipped)
- A03 Tenant boundaries: BLOCKED. Cross-account UI proof needs two identities and the agency fixture
- A04 Grant precision: BLOCKED. Recipient-side view of a narrow grant needs two identities
- A05 Invitation: NOT_EXECUTED. Accept pages never driven through the UI
- A06 Upload threats: BLOCKED. Production scanner is unconfigured and the built-in one refuses every PDF
- A07 Upload integrity: NOT_EXECUTED. Not run against the real file store
- A08 Safe delivery: BLOCKED. Wrong-user and revoked-grant delivery need two identities in a browser
- A09 Profile history: NOT_EXECUTED. History tab never driven with real sign-in
- A10 Private notes: BLOCKED. Note privacy between agencies needs two identities
- A11 Requests and tasks: BLOCKED. Member-to-traveller request journey needs two identities and the agency fixture
- A12 Rule regression: BLOCKED. Rules sign-off by an accountable person is Part 10 section 8 (owner)
- A13 Manual route: NOT_EXECUTED. Not driven through the UI
- A14 Snapshot minimisation: PASS. Direct automated proof, green on this commit
- A15 Acknowledgement: NOT_EXECUTED. Mechanism tested
- A16 Post-approval change: NOT_EXECUTED. Not driven through the UI
- A17 Alerts: NOT_EXECUTED. 6 of 11 event types covered
- A18 Email provider: BLOCKED. No real provider account, key or webhook secret
- A19 AI providers: BLOCKED. No live provider configured (`aiExtraction` is unconfigured in production)
- A20 AI quality: BLOCKED. Needs a real model and a person who judges the output
- A21 AI privacy: BLOCKED. Needs a real provider and the privacy reviewer
- A22 AI endpoints: NOT_EXECUTED. Not implemented
- A23 AI resilience: BLOCKED. Needs a real provider outage drill
- A24 AI concurrency: NOT_EXECUTED. Unit level only
- A25 Encryption: BLOCKED. Master key has no rotation tool or escrow
- A26 Audit: NOT_EXECUTED. Not run against the production audit trail
- A27 Privilege: NOT_EXECUTED. Support-grant privilege has no admin screen
- A28 Commerce: NOT_EXECUTED. Not driven through the UI
- A29 Privacy: NOT_EXECUTED. Export and deletion screens need a real session
- A30 Recovery: BLOCKED. Restore never rehearsed
- A31 Deployment safety: NOT_EXECUTED. Rollback never rehearsed
- A32 UX, language, accessibility: BLOCKED. Screen-reader pass owed to a person
- A33 Capacity: NOT_EXECUTED. Measured on one machine against plain Postgres
- A34 Public trust: NOT_EXECUTED. Live catalog is empty (no published route), so the route page was not seen live
- A35 Independent review: BLOCKED. Cannot be self-certified

## SECURITY

- Critical: 0 (the 3 development-tool advisories were cleared by upgrading the test runner; see `part-10-security-scans.md` addendum)
- High: 0 (the 1 development-tool advisory was cleared the same way)
- Medium: 2 (1 in production, a text-formatting library inside the DOCX reader with no patched version; 1 in a development build tool)
- Low: 0 reported by the audit tool (it does not grade lower findings)
- Also open, not scanner findings: staff MFA not enforced; master key with no escrow or rotation (and the local key provider refuses to start in commercial mode by design, so commercial mode needs a real key service); no independent backup of document files; no outside monitoring or paging
- Independent review status: BLOCKED. None exists. Internal review is never called a penetration test. Commercial admission stays blocked
- Scans: 11 executed, 11 passed, 0 failed, 2 skipped (CodeQL, which cannot run on a private repository; SSRF, for which no test exists because nothing fetches a user-supplied address). Re-run clean on the branch head `3fbaeef` after the test-tool upgrade. Full table: `part-10-security-scans.md`

## INTEGRATIONS

- WorkOS: available. MFA off at the provider and not enforced in code. Production-project approval is an owner act
- Storage: Neon database and private file store available; original and redacted downloads disabled; no independent file backup
- KMS: a locally held master key only. No external key service, no rotation tool, no escrow
- Scanner: ClamAV adapter built and live-tested once earlier; not configured in production. The built-in scanner refuses every PDF, so no PDF can be released today
- Email: provider port and signed webhook built; no account; no live delivery ever tested
- OpenAI: adapter built, tested with stubs only; no account or endpoint recorded
- Gemini: same
- Anthropic: same
- Monitoring: structured errors, live and ready health endpoints, log viewer. No outside probe, no paging, availability not measurable from here

## RULE PACKS

- Pack 1: none published
- Pack 2: none published
- Golden tests: none exist (the directive needs at least 20 reviewed cases per pack)
- Content reviewer: none appointed. Release is BLOCKED on this; the bar was not lowered

## RECOVERY

- Measured RPO: none
- Measured RTO: none (targets stay 15 minutes and 4 hours; not rewritten)
- Drill evidence: none. A30 is BLOCKED: no approved test branch, no independent copy of document files, no key escrow

## PRIVACY/LEGAL

- Completed operational controls: consent records, export, erasure with legal hold, retention classes, support-access grants limited to 60 minutes with a reason and an approver, audit trail, per-record encryption of protected fields (all tested in code)
- External approvals still required: legal review of terms, privacy notice and consent wording; privacy review of each AI provider's data terms and of cross-border storage; data processing agreements with each provider; decision on where real customer documents may live. No compliance certification is claimed

## PERFORMANCE

Measured at this SHA on one 4-CPU machine, database next door:

- 50 sessions plus 5 document workers: p50 16 ms, p95 39 ms, p99 57 ms, 0 errors, at most 7 database connections (target: p95 under 800 ms). Slowest screen p95 62 ms
- 4x the launch rate: 214 views a second, 0 errors, p95 376 ms
- Scanner outage stops release: met
- Not measured: PDF processing time with a real scanner at this SHA; availability; behaviour against Neon at launch size from the app's own region

## EXTERNAL BLOCKERS

| Owner | Exact action needed |
| --- | --- |
| Owner | Incident owner Incidentman and backup Backupman are designated; record contact routes, acceptance, and hold the tabletop |
| Owner | Rules owner Ruleman and reviewer Reviewman are designated; commission two launch routes with 20 reviewed cases each, reviewed by Reviewman |
| Owner | Privacyman, Supportman and Legalman are designated; a qualified lawyer must stand behind Legalman for terms, privacy notice and consent wording |
| Owner | Set price, currency and plan allowances |
| Owner | Commission an independent security review and retest, or supply a report |
| Owner | Approve a Neon test branch for the restore drill; fund a second store for document files; create and escrow the key with two holders |
| Owner | Create the two staging test identities and the agency fixture so journeys J01 to J15 can be run |
| Owner | Open business accounts: email, three AI providers, a scanner host; record terms |
| Owner | Move the repository, hosting and identity accounts to the VisaStack entity with a second administrator |
| Engineering (next task) | Add an outside uptime probe (a scheduled workflow was attempted and refused by the session's safety layer; the owner can add it or use a free monitor); enforce staff MFA; key rotation tool; a real key service for commercial mode |

## KNOWN ISSUES

Full evidence log: `known-issues.md` (chunks 45 to 48 are the latest). Headline items: staff MFA not enforced; master key with no escrow; no document backup; daily not hourly reminder sweeps; weekly audit alerts reach one email address; the runtime readiness guard keeps hardcoded and environment-flag gates that are not release evidence; Bangla deferred by the owner (not a pass).

## HANDOVER

`handover-inventory.md`. The directive's test (no critical system depends on one person's personal account) FAILS: source, hosting, database, files, identity and the master key each rest on accounts whose ownership or second administrator is unconfirmed.

## COMMITS / PR

- Main at `a27cefb` (PR 172, merged by the owner)
- Release-candidate PR: draft, documentation only, not merged (link in the chat reply)
- PR 77 untouched (open, draft)

## NEXT THREE ACTIONS

1. Appoint the incident owner, rules owner and reviewer, privacy owner and support contact, and set the price. Nothing else can be attested without people.
2. Commission the independent security review and approve a Neon test branch, funding document backup and key escrow, so the recovery drill and the review can finally run.
3. Create the two staging test identities and the agency fixture, so the 15 customer journeys can be run for real.
