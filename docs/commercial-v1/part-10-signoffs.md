# Part 10 sections 8 to 10 and 13: sign-offs

Written 2026-10-06 (Task 8). Code under review: `a27cefb8bd40e0f766870309b02a848c1917307d` (main after PR 172). Method: read the repository and the live health endpoint. No approval below was invented. A row is only "approved" if a named person approved it on a date with a link; today none is.

Rule used throughout: **a sign-off needs a person.** This session can check that a control exists and works. It cannot approve content, legal wording, privacy terms, prices or ownership on anyone's behalf.

## Section 8: rules and content sign-off

| Check the directive names | Finding | State |
| --- | --- | --- |
| At least two complete launch packs | The code to build, review and publish packs exists (`packs.ts`, trust pages). The live public catalog has **no published route**. Zero launch packs are complete. | BLOCKED |
| Official sources current | No pack is published, so no source is on a review clock. Source fields, freshness and withdrawal exist in the code (RUL-02, RUL-05). | NOT EXECUTED |
| Reviewer distinct from author | The rule exists in code. No reviewer has been appointed, so it has never been exercised on real content. | BLOCKED |
| Golden cases, at least 20 per pack | There is no golden-case suite in the repository. The rule-engine tests prove how rules are evaluated; they are not 20 reviewed cases per route. | BLOCKED |
| Review dates valid | Nothing to date. | NOT EXECUTED |
| Stale content handled | Stale and withdrawn states exist and are tested. Not exercised on live content. | PARTIAL (code only) |
| Public trust cards consistent | `/trust` loads (HTTP 200, one top heading). It shows no routes, so consistency of cards could not be checked. | NOT EXECUTED |

**Result: release BLOCKED on rules and content.** The bar is not lowered. What is needed: a qualified person to author and a different qualified person to review at least two launch routes from current official sources, with at least 20 golden cases each.

## Section 9: provider and privacy sign-off

Current official terms for each provider were not re-read in this session (outbound reading is limited and the cost rules forbid whole-page fetches). Terms recorded in `cost-and-vendor-register.md` carry the review dates shown there and must be re-confirmed by the owner before any launch. No compliance certification is claimed for VisaStack.

| Area | Configured today (production, read live) | Terms and approvals | State |
| --- | --- | --- | --- |
| AI providers (OpenAI, Gemini, Anthropic) | `aiExtraction: unconfigured`. Three adapters exist and pass their tests against stubs. No business account, endpoint, retention term or approved data class is recorded. | No privacy or legal approval | BLOCKED |
| Email (Resend) | Port and signed-webhook receiver built. No account, key or webhook secret. | Vendor claims SOC 2 Type II and GDPR terms (vendor statements, dated 2026-09-22). No VisaStack approval | BLOCKED |
| Malware scanner (ClamAV) | `malwareScanning: unconfigured`. Built-in scanner refuses every PDF. No host for the scanner process chosen or costed. | None needed for the engine; hosting is open | BLOCKED |
| Storage (Vercel Private Blob, Neon) | Available. Original downloads and redacted downloads are disabled in production. | Not independently approved | PARTIAL |
| Identity (WorkOS) | Available. MFA is off at the identity provider; staff MFA is not enforced in code. | Production project attestation is an owner act | BLOCKED |
| Key service | A locally held master key (`KMS_LOCAL_MASTER_KEY_BASE64`). No rotation tool, no escrow, no external key service. | None | BLOCKED |
| Monitoring | Structured errors, health endpoints, console log sink. No outside uptime probe, no paging. | None | PARTIAL |
| Backups | Database history on the provider's tier only. Document files have no independent backup. | None | BLOCKED |
| Terms of service and privacy notice | No published page exists in the app. | Needs a qualified legal reviewer | BLOCKED |

**External approvals still required (label, not claim):** legal review of terms, privacy notice and consent wording; privacy review of each AI provider's data terms and of cross-border storage; DPA with each provider that handles personal data; a decision on where real customer documents may be stored.

## Section 10: commercial operational sign-off

| Item | Recorded | Approver | State |
| --- | --- | --- | --- |
| Plan allowances | Plans, entitlements and manual billing exist in code. Allowance values for a paid launch are not set by the owner. | none | BLOCKED |
| Price and currency | Not set. Payments are unconfigured by design. | none | BLOCKED |
| Billing process | Manual billing screens exist; no written process and no payment provider. | none | BLOCKED |
| Support contact | Supportman designated by the owner, 2026-10-06. No published address | owner (designation only) | PARTIAL |
| Primary and backup incident owner | Incidentman (owner) and Backupman (backup) designated by the owner, 2026-10-06. No contact route, no tabletop held. | owner (designation only) | PARTIAL |
| Rules owner and reviewer | Ruleman (rules owner) and Reviewman (reviewer, a different person) designated by the owner, 2026-10-06. No reviewed content exists yet | owner (designation only) | PARTIAL |
| Privacy owner | Privacyman designated by the owner, 2026-10-06. No contact route | owner (designation only) | PARTIAL |
| Infrastructure ownership | Inframan designated by the owner, 2026-10-06. Vercel project sits under a team slug that carries a personal name, and the source repository is under a personal GitHub account. Whether these belong to the intended VisaStack entity is for the owner to confirm. | none | UNCONFIRMED |
| Domain, cloud, identity, data, secrets, billing accounts belong to the owner entity | Not verifiable from the repository. | none | UNCONFIRMED |

## Section 13: runtime degradation versus release eligibility

These are kept apart on purpose. A degraded mode at runtime never means a launch control was missing, and a missing launch control is never excused because the product degrades safely.

| Situation | Runtime behaviour (proved) | Does it affect release eligibility? |
| --- | --- | --- |
| Optional AI outage | AI is off; manual profile, documents and sharing continue (load run had no AI configured and every core screen worked) | No. Eligibility needs the AI adapters tested live; that is a separate gate (A19 to A24) |
| Core scanner outage | New files stay quarantined and are not released (tested against a dead scanner socket) | No. Eligibility needs a real scanner running; today there is none (A06) |
| Core auth, storage or security failure | The affected operation is refused | No. Eligibility needs those controls proven (A01, A25, A26) |

## What would unblock this section

1. Appoint: incident owner and backup, rules owner, rules reviewer (different person), privacy owner, support contact.
2. Set price, currency and plan allowances.
3. Commission a qualified legal review of terms, privacy notice and consent wording.
4. Open business accounts with the AI providers, the email provider and a scanner host; record the data terms with a date and an approver.
5. Confirm in the dashboards that every account is held by the VisaStack entity and has a second administrator.
