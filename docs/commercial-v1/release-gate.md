# Commercial V1 Release Gate

Completed 2026-10-06 (Part 10 section 12). This is a record, not a switch. Nothing in it is a flag, and no field is filled with a default "true". Every attestation needs four things: an evidence link, a named approver, a date, and the event that makes it stale. A row with no approver is not attested, whatever the code says.

**Gate state: NOT ELIGIBLE.** Verdict: CODE COMPLETE - COMMERCIAL LAUNCH BLOCKED (see `final-report.md`).

Separate from this record: the runtime readiness guard in `apps/web/src/lib/commercial-readiness.ts` reads environment attestation flags. Those flags are a convenience for the application and are NOT release evidence. Setting one does not satisfy this gate, and this gate does not set one. Two of its gates are hardcoded in code ("safe conversion", "retention and deletion workflow"); they were audited in `known-issues.md` item 77 as overstated, and are not relied on here.

## 1. Build under test

| Field | Value | Evidence |
| --- | --- | --- |
| Code SHA tested | `a27cefb8bd40e0f766870309b02a848c1917307d` | git history of main; PR 172 squash merge |
| Branch | main at that SHA; release-candidate branch `claude/pensive-cray-4fhand` originally carried documentation only; it later gained the test-tool upgrade and Neon Auth sign-in phase 1 (off by default), so this record must be re-validated on the new head (section 6) | PR link in final report |
| Build id | Vercel production build for that SHA | Deployment `dpl_EBYqheEpDEEdNmvSSsSbCn4mDtxV`, state READY, created 2026-10-06 |
| Deployment id | `dpl_EBYqheEpDEEdNmvSSsSbCn4mDtxV` | Vercel deployment list, read 2026-10-06 |
| Environment | Production, mode `controlled_pilot` (made-up data only). **No isolated staging environment exists.** The directive asks for staging; this was not possible and is recorded as a gap, not substituted silently | `/api/health/ready` read live: ready, `realApplicantData: disabled`, `commercialClaims: disabled`, `payments: unconfigured` |
| Deployed SHA equals tested SHA | Yes, for the pilot production deployment | Vercel deployment metadata `githubCommitSha` equals the tested SHA |
| Schema version | Newest migration in the repository: `0083_vengeful_lionheart` (84 files) | `packages/db/migrations`; production applied level is checked by the readiness endpoint (ready) but was not read directly |
| Migrations run this task | None. No production migration was run or requested | This session |

## 2. Reports at this SHA

| Report | Result | Where |
| --- | --- | --- |
| Install with frozen lockfile, lint, typecheck, unit and service tests, production build, production dependency audit, supply-chain scans and their self-tests | see `part-10-security-scans.md` (run 2026-10-06 on this exact SHA) | that file |
| Browser checks (public pages, security headers, sign-in redirects) and smoke | see `part-10-security-scans.md` | that file |
| Load run | Not reusable: the Part 9 load run was on an earlier SHA. Re-run result in `part-10-security-scans.md` | that file |
| Authenticated single-account and cross-account Playwright | NOT RUN (needs two staging identities and the agency fixture) | `part-10-journeys.md` |
| Rule golden suites | DO NOT EXIST | `part-10-signoffs.md` section 8 |
| AI live synthetic, email live synthetic, scanner live fixture | NOT RUN in production (no provider, no account, scanner unconfigured). The scanner was live-tested once against a local ClamAV in an earlier part; that is not a report for this SHA or environment | `part-10-acceptance-matrix.md` A06, A18, A19 |
| Export and privacy suite | Unit and service level only | A29 |
| Accessibility | Automated whole-page scans only; screen-reader pass owed to a person | `part-9-checkpoint.md` |

## 3. Provider configuration and rule packs

| Field | Value |
| --- | --- |
| Provider config (read live) | authentication available; AI extraction unconfigured; malware scanning unconfigured; payments unconfigured; original and redacted downloads disabled; public sign-up disabled |
| Rule-pack versions | None published |

## 4. Attestations

Every row needs evidence, approver, date, and a revalidation trigger. Empty approver means NOT ATTESTED.

| # | Attestation | Evidence link | Approver | Date | Revalidation trigger | State |
| --- | --- | --- | --- | --- | --- | --- |
| G01 | Tenant isolation proven in a real browser with two accounts | `part-10-acceptance-matrix.md` A03; spec bodies written, never run | none | none | Any change to authorisation or sharing code | NOT ATTESTED |
| G02 | Real malware scanner running in production | `/api/health/ready` shows scanning unconfigured | none | none | Scanner host, signature, or adapter change | NOT ATTESTED |
| G03 | Real email delivery and signed webhook | none | none | none | Provider, key or domain change | NOT ATTESTED |
| G04 | AI adapters tested live and privacy-approved | none | none | none | Provider, model, endpoint or data-term change | NOT ATTESTED |
| G05 | Rules and content signed off (two packs, 20 golden cases each, distinct reviewer) | `part-10-signoffs.md` section 8 | none | none | Any source change, or 90 days | NOT ATTESTED |
| G06 | Legal approval of terms, privacy notice and consent wording | none | none | none | Any wording or jurisdiction change | NOT ATTESTED |
| G07 | Restore drill measured against RPO 15 minutes and RTO 4 hours | `part-10-security-scans.md` A30 section: not run | none | none | Backup tier, provider, key or schema change | NOT ATTESTED |
| G08 | Independent security review and retest, no open Critical or High | none | none | none | Any significant change after the report | NOT ATTESTED |
| G09 | Key escrow and rotation exist | none | none | none | Any key change | NOT ATTESTED |
| G10 | Independent backup of document files | none | none | none | Storage change | NOT ATTESTED |
| G11 | Incident owner and backup named; tabletop held | Owner designated Incidentman (owner) and Backupman (backup) on 2026-10-06; no contact route or acceptance; `incidents/tabletop.md` is a template, no tabletop held | none | none | Staff change | NOT ATTESTED |
| G12 | Rules owner, privacy owner, support contact named | Owner designated Ruleman (rules owner), Reviewman (reviewer), Privacyman (privacy owner), Supportman (support contact) on 2026-10-06; no contact routes or acceptance | none | none | Staff change | NOT ATTESTED |
| G13 | Price, currency and plan allowances set by the owner | none | none | none | Any price change | NOT ATTESTED |
| G14 | Infrastructure and accounts held by the VisaStack entity with a second administrator | `handover-inventory.md` | none | none | Any account change | NOT ATTESTED |
| G15 | Real-person end-to-end journeys J01 to J15 | `part-10-journeys.md` (all BLOCKED) | none | none | Any journey screen change | NOT ATTESTED |
| G16 | Staff MFA enforced | `threat-model.md` (off at the provider and in code) | none | none | Identity provider change | NOT ATTESTED |
| G17 | Outside uptime probe and paging | `monitoring.md` (none exists) | none | none | Monitor change | NOT ATTESTED |
| G18 | Screen-reader and keyboard pass by a person | `part-9-checkpoint.md` (owed) | none | none | Any screen change | NOT ATTESTED |

Attested: 0 of 18.

## Owner designations (recorded 2026-10-06, after the first release-candidate report)

The owner named, in chat, the incident owner as **Incidentman** and the rules owner as **Ruleman**. The message ended before the remaining roles (backup incident owner, rules reviewer, privacy owner, support contact, price). These are recorded as the owner's designations. They are not yet attestations: an attestation also needs a reachable contact route for the person, the person's acceptance, and (for rules) a reviewer who is a different person and qualified. Until then G11 and G12 stay NOT ATTESTED. The rules owner may not review their own rules.

### Role designations

| Role | Designated | Source | Still needed before it counts as attested |
| --- | --- | --- | --- |
| Incident owner | Incidentman | Owner, chat 2026-10-06 | Contact route; acceptance; tabletop held |
| Backup incident owner | Backupman | Owner's instruction to name roles in the same format, 2026-10-06 | Same |
| Rules owner | Ruleman | Owner, chat 2026-10-06 | Contact route; acceptance |
| Rules reviewer (a different person from the rules owner) | Reviewman | Owner's instruction, 2026-10-06 | Qualification for the routes reviewed; acceptance |
| Privacy owner | Privacyman | Owner's instruction, 2026-10-06 | Contact route; acceptance |
| Legal reviewer | Legalman | Owner's instruction, 2026-10-06 | A qualified lawyer behind the name; written approval |
| Support contact | Supportman | Owner's instruction, 2026-10-06 | A published address or number |
| Infrastructure owner | Inframan | Owner's instruction, 2026-10-06 | Confirmation that the accounts belong to this person or entity, plus a second administrator |
| Key holders (two, held separately) | Keyman and Vaultman | Owner's instruction, 2026-10-06 | Two real people, two separate sealed copies |
| Billing and pricing owner | Priceman | Owner's instruction, 2026-10-06 | The price, currency and plan allowances themselves (not yet set) |
| Security review coordinator | Auditman | Owner's instruction, 2026-10-06 | An independent outside reviewer; the coordinator cannot be the reviewer |

These names are role labels the owner chose. They fix who is accountable in the documents. They do not stand in for evidence: where the last column asks for a real person, a contact route or a qualification, the row stays open until it is recorded with a date. Distinctness rule kept: Ruleman and Reviewman are different, and Auditman coordinates but never reviews.

## 5. Scan timestamps and owners

Scan timestamps and results: `part-10-security-scans.md`. Incident owners: none appointed. Approvers: none have approved anything in this record.

## 6. Revalidation conditions

The record is void and must be redone if: the code SHA changes in any file under `apps/`, `packages/`, or the migrations; a provider, key or storage setting changes; a rule pack is published or changes; a dependency advisory of high or critical level appears; an attestation passes its trigger. A report from a different SHA or environment is never reused.
