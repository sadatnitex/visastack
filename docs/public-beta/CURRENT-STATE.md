# Current product and release state

Verified checkpoint: 2026-10-12 18:48 Asia/Dhaka. This page records what is deployed, what evidence exists, and what remains open. It supersedes older candidate/provider/default descriptions. Historical evidence and original acceptance targets remain intact. It is not a public sensitive-data release approval.

## Live product

VisaStack helps travellers keep reusable profiles, documents and visa cases, and share chosen records with agencies. Travellers control their own records. Agency workspaces provide authorized clients, cases, evidence requests and team tools. The platform administration workspace retains granular operational, provider, organization, security and policy tools. A dashboard's existence does not prove every action or metric has completed live acceptance.

Production is https://vs.obsidianglobal.studio, with https://visastack-five.vercel.app as the verified fallback. Registration is available, but operation remains a controlled pilot using synthetic records. Real applicant data and commercial claims are disabled. Public sensitive-data release remains BETA_BLOCKED; no final release candidate or unrestricted launch verdict has been approved.

| Area | Current reality | Evidence still required |
| --- | --- | --- |
| Identity | Production selects Neon Auth. Legacy WorkOS code is retained behind explicit selection. Email confirmation/reset does not transfer records or administrator rights. | Complete signup/confirmation/reset and privileged MFA/lifecycle journeys. |
| Profiles and cases | Canonical immutable facts, owner-approved changes, family/profile tools, versioned documents, mission/case workspaces and manual preparation paths are implemented. Readiness means requirement completeness, never visa approval probability. | Full role/lifecycle acceptance, including denials, unavailable states and recovery. |
| Documents | Private R2 with the existing private Vercel Blob mirror. Structural validation, native text/MRZ parsing and bounded private-worker OCR are implemented. PDF Buffer inputs are normalized without changing stored bytes/hashes. Missing passport expiry is unknown, not evidence that a passport has no expiry. Extracted values require review. | The real scanner/R2 run and authenticated upload-to-review lifecycle. No universal passport-reading accuracy claim. |
| Scanning | The main-only GitHub worker installs ClamAV with fresh official definitions and offers process-queue and verify-synthetic modes. The latter checks direct R2 bytes, the mirror, clean/threat controls, PDF extraction and its own cleanup without opening the production database. | Actual successful worker steps. Public readiness currently reports malwareScanning=unconfigured. Structural checks and a skipped job do not prove antivirus acceptance. |
| Personal sharing | PR 200 is live. Specifically approved migration 0085 was applied and verified, with 86 migrations applied and none pending at that inspection. PERSONAL_SHARING_INVITATIONS_ENABLED=true is verified in Production. A new recipient can receive a pending invitation before registering. | Actual recipient signup, confirmation, acceptance and inbox receipt. Creating an invitation grants no access. |
| Team/client invitations | Email outbox, copy/share and account handoff are deployed. Team links are bound to the invited email; existing team accounts retain immediate-add behavior. Client links retain authenticated token-holder acceptance and explicit profile/consent choice. Phone contacts use manual link sharing, with no new SMS provider. | Complete inviter/recipient journeys and physical inbox receipt. These recipient policies are intentionally distinct. |
| Mail | Neon Auth SMTP handles identity emails separately from Resend application delivery. Application sender and signed callback settings are configured; live callback signature boundaries were checked. | Real branded mail rendering, verification/reset/invite receipt and delivery reconciliation. Provider-delivered status is not inbox placement. |
| Encryption/recovery | Production PROTECTED_FIELDS_PGCRYPTO=required is verified. Weekly encrypted database backups to R2 and an isolated database-only restore have evidence. | Application-key rotation/independent escrow, document/key/audit/tombstone/revocation recovery and measured objectives. Weekly backups do not satisfy the original 15-minute RPO. |
| AI and payments | Provider adapters, consent, budgets, human approval and manual paths exist. Current public readiness reports AI extraction and payments unconfigured; redacted downloads disabled. Founding access remains complimentary. | Reviewed provider/privacy/source/cost evidence and any separately authorized activation. |

No platform role is granted solely by email. Account-menu traveller/agency management links are not permission grants. Legal holds, exact-version records, consent, audit and quarantine remain enforced by their existing boundaries.

## Deployed reference work and acceptance

The ten-page PDF is the composition reference with the approved flat refinement. All ten pages were rendered before styling changes. Intentional navy accents remain contained, with no automatic OS dark-theme substitution. Traveller documents/cases/sharing, agency pipeline/team/requests and the operational admin overview have deployed composition changes; specialized tools remain reachable. Account and workspace navigation have distinct roles, compact multiword-name handling and responsive menu treatments.

Actual Neon-backed route/device checks passed 52 checks, plus separate sharing and pre-account link/handoff checks. Those runs used synthetic records and are narrower than complete lifecycle acceptance. The latest hero uses 300px support cards and 40px lower clearance at desktop; mobile uses full-width cards and 32px clearance. Both appearance preferences matched. All 192 final no-secret browser checks passed; fixtures do not replace authenticated acceptance.

| Work package | Status | Remaining |
| --- | --- | --- |
| CF-04: documents, case, sharing | Deployed implementation with route/action evidence | Real provider-backed complete document/sharing journeys. |
| CF-05: agency | Deployed reference-based composition | Full owner/worker/client invitation, permissions and lifecycle journeys. |
| CF-06: administration | Deployed operational composition with specialized tools retained | Complete privileged action/MFA acceptance and measured provider/cost/capacity readings. |
| CF-07/08: public and route coverage | Deployed refinements with responsive/browser checks | Complete remaining action, help, accessibility and route-state acceptance. |
| CF-09: real acceptance | Incomplete | Isolated authenticated roles, all ten actual compositions, significant desktop/mobile journeys, scanner/storage, inbox, MFA and complete recovery evidence. |

CF work packages describe UI and functional acceptance. Public-beta PR-00 through PR-09 are a different programme: baseline is recorded; identity, mail/admission, founding access, documents, role journeys, jobs, packs/AI and founder controls retain the gaps above; final release acceptance remains gated. Neither numbering scheme means all work is complete.

## Release evidence

- [PR 200](https://github.com/sadatnitex/visastack/pull/200): merge 491c15a63fbe040651a241740b82b2d5c0f1a112, required source/main checks, both deployment smoke workflows, aliases and readiness verified. Migration 0085 and invitation activation verified separately.
- [PR 201](https://github.com/sadatnitex/visastack/pull/201): merge fe7d982e17d5a6e114df527822d52617076f758d, deployment dpl_HErFKpxfbiKS62qcdR3jh6JDZ94f. Required source checks, both deployment smoke workflows, aliases, readiness and changed hero CSS verified. Post-merge main CI was still running at this checkpoint; it is not described as passed.
- Local PR 201 regression: 3,134 workspace tests passed, three existing environment-specific skips; 192 browser checks passed with no skips; seven supply-chain checks passed with no skips; 17 scanner self-tests passed. High-severity production audit exited 0 with four moderate advisories. CodeQL was skipped on the private repository, not passed.
- The owner confirmed the Actions intake variables and secrets are configured. That is configuration confirmation, not independent credential-use or scanner acceptance. The actual verify-synthetic run remains pending the release checks.

## Operating boundaries

Use [current operations](../operations/current-platform.md), [invitation policy](../operations/invitation-journeys.md) and [release requirements](RELEASE-ACCEPTANCE-CHECKPOINT.md). Production migrations require specific authorization; no new migration accompanies this documentation update. Staging has a separate project/Auth endpoint and empty schema, but fully isolated accounts, app/storage bindings and complete staged journeys are not certified. Neon branch count must stay below ten, with deletion only after dependencies prove a branch unnecessary; no current inventory count is asserted here.

Never put credentials or usable invitation links in documentation. An unavailable measurement is unavailable, not zero. Paid activation, legal/privacy sign-off, sensitive-data intake and final commercial release remain separate decisions. Bangla translation is deferred.
