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
- [PR 201](https://github.com/sadatnitex/visastack/pull/201): merge fe7d982e17d5a6e114df527822d52617076f758d, deployment dpl_HErFKpxfbiKS62qcdR3jh6JDZ94f. Required source checks, both deployment smoke workflows, aliases, readiness and changed hero CSS verified. Post-merge main CI subsequently passed. PR 201 source/main and deployment verification is complete.
- Local PR 201 regression: 3,134 workspace tests passed, three existing environment-specific skips; 192 browser checks passed with no skips; seven supply-chain checks passed with no skips; 17 scanner self-tests passed. High-severity production audit exited 0 with four moderate advisories. CodeQL was skipped on the private repository, not passed.
- The owner confirmed the Actions intake variables and secrets are configured. That is configuration confirmation, not independent credential-use or scanner acceptance. The actual verify-synthetic run was attempted after the release checks passed. It failed during scanner installation because clamdscan was a suggested package omitted by --no-install-recommends. No storage/control step executed; scanner/storage acceptance remains open. The follow-up explicitly installs the package and checks the required executables before waiting for the daemon.

## Operating boundaries

Use [current operations](../operations/current-platform.md), [invitation policy](../operations/invitation-journeys.md) and [release requirements](RELEASE-ACCEPTANCE-CHECKPOINT.md). Production migrations require specific authorization; no new migration accompanies this documentation update. Staging has a separate project/Auth endpoint and empty schema, but fully isolated accounts, app/storage bindings and complete staged journeys are not certified. Neon branch count must stay below ten, with deletion only after dependencies prove a branch unnecessary; no current inventory count is asserted here.

Never put credentials or usable invitation links in documentation. An unavailable measurement is unavailable, not zero. Paid activation, legal/privacy sign-off, sensitive-data intake and final commercial release remain separate decisions. Bangla translation is deferred.

## Subsequent checked result, 2026-10-12

PR 202 documentation update merged as 0d6a3478dbe14d5e1cab09430a21ffe7be288232 and is deployed as dpl_FhSqgEe69fq4v2VN2LoS2jurVEWk. Required source checks, both deployment smoke workflows, aliases and readiness passed. Main CI remains pending at this follow-up inspection. PR 201 completed its main CI and both deployment smoke workflows. [Actual scanner run 38253171932](https://github.com/sadatnitex/visastack/actions/runs/38253171932) failed at installation; live engine controls and synthetic storage processing were skipped because of that failure, not counted as passed. The workflow repair does not change credentials, scanner policy, queue mode or the main/enablement gate.

## Interface upgrade in progress, 2026-10-13

An interface upgrade is under way and is recorded in [the experience upgrade handoff](../uiux/EXPERIENCE-UPGRADE-HANDOFF.md). Phase 0 (a counter that may only go down, page capture and screenshot comparison) and Phase 1 (plain words instead of stored codes, no visible long dashes) were merged in pull request 204 as 9afdf3c on 2026-10-13. The production deployment reached READY, both deployment smoke runs passed and the live readiness page returned ready; signed-in screens were not checked on a real sign-in, and the CI run on main had not finished when this was recorded. Phase 2 (loading, empty and error states) was approved by the owner and built; its merge and verification are recorded in the known-issues log. The remaining phases are planned and each needs the owner's approval of a visual preview first. Nothing in this section changes any acceptance status above.


## Client invitations update, 2026-10-25

Client invitations now go to an email address only and are bound to it: only an account signed in with that address can open or accept one, as with team invitations. A phone number is refused when the invitation is created, and an older invitation saved with a phone number can no longer be accepted (the agency's client list says to revoke it and invite again by email). This replaces the "Client links retain authenticated token-holder acceptance" and "Phone contacts use manual link sharing" parts of the invitations row above. Details: [known issues, client invitations are email only](../commercial-v1/known-issues.md).


## Update, 2026-10-26

This section supersedes the rows above where they differ. Earlier rows stay as the record of their checkpoints.

- **Identity:** WorkOS is retired (#237). Neon Auth is the only sign-in system; any other identity setting is refused and reported by readiness. The public beta (free, at your own risk, #233) opens public sign-up only when `PUBLIC_BETA_OPEN=true` and Neon Auth is fully configured; otherwise sign-up is invite-only.
- **Database:** 90 migrations applied in production. The latest three were each run right after their merge with the owner's approval for that run: 0087 document protection switches, 0088 profile photos, 0089 AI provider data terms.
- **Traveller workspace:** task-first first run; four tabs (Home, Record, Cases, Sharing) with My Profile, Documents, Dates & Expiry and History inside the Record hub; case journey view and changed-case alert; Application Memory and then-and-now view; profile photos; visa photo sizes cut on request from one passport photo (no acceptance claim).
- **AI:** suggestions are saved only after a person approves, including the AI document kind and name (on request). What Your Documents Show names restricted documents by kind and section only. Readiness now reports AI extraction from the same decision the live calls use, including the admin AI settings (#270); production readiness returned "available" when checked live on 25 Oct 2026 at 20:22 UTC and 26 Oct 2026 at 00:21 UTC. Provider data terms are recorded per configuration. The "Only Use AI Providers That Do Not Train on Inputs" setting is built and off (owner decision: free tiers are not blocked until the owner says so), and a setting that cannot be read also counts as off.
- **Sharing:** the safe copy permission is shown as "Download Safe Copies" and is grantable; today it covers visa photo sizes. Real redaction of documents is parked by the owner, and readiness still reports redacted download as disabled.
- **Agencies:** triage groups, a Do Next list (its ranking rule is recorded) and a copy-ready follow-up message the agency sends itself.
- **Still open:** malware scanning (readiness reports it unconfigured), staff two-step sign-in acceptance, document and key recovery, real applicant data (disabled), payments (parked), Bangla (deferred). The final release review is Programme X WP-V6 and needs the owner's explicit decision.

Evidence for each merge: [known issues](../commercial-v1/known-issues.md) and [the session handoff](../upgrades/programme/SESSION-HANDOFF-2026-10-25-evening.md).



## Update, 2026-10-29

This section supersedes the rows and sections above where they differ. Earlier sections stay as the record of their checkpoints. Package status lives in [the Small Commercial handoff, section M](../roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md); interface status in [Programme X STATUS](../upgrades/programme/STATUS.md); setup facts in [current operations](../operations/current-platform.md).

**Live (merged and deployed from main):**

- **AI apps (Small Commercial S13 to S16):** a person can connect their own AI app (Claude or ChatGPT) to VisaStack through a sign-in and consent screen (#305). The app can only read what the person chose, through five read-only tools: list cases, prepare context, a profile section, list documents, a document's text (#310). The Sharing page lists each connection and lets the person see, narrow or turn it off; one set of choices is shared with the consent screen, and a backup restore re-applies turn-offs (#315). Every AI read is audited without personal content, and staff see connection and call counts on AI Settings (#317). The owner switched the connector on in production on 28 Oct; the sign-in discovery address answers and readiness reports the connector available. Not verified: a real Claude or ChatGPT connection end to end.
- **Payments (S10 to S12):** the payment ledger (#287), the online payment flow (#292, built and switched off) and agency invoices with "I Paid Another Way" claims and numbered receipts (#299) are deployed. Readiness reports payments unconfigured because no payment provider account is set up. Not verified: the signed-in agency invoice screens on the live site.
- **Interface:** the owner's 19-item interface and quality list (A1 to A12, B13 to B19) through #304, #306 to #309 and #311; the invitation page redesign (#314); a visual alignment pass (#316); Calm Core With Depths (Glance, Browse and Everything) on the signed-in screens, CCD-0 to CCD-7, with the contrast layer WP-C2, one design for every email and the time zone picker (#318 to #336). Details: STATUS.
- **Calendar:** a private live calendar link (#309; migration 0101 run with the owner's word).
- **Readiness and backup (S27, #337):** the AI gate no longer depends on one provider; the scanner gate accepts the private scan runner only with proof from the last 72 hours; agency logos and photo proofs of payment are re-encoded on the server; the encrypted database backup runs daily, with a daily freshness check. Automatic pruning of old backups is built and only reports until the owner turns it on.
- **Database:** the repository holds migrations up to 0101 (100 in all; the numbers 0098 and 0099 are unused). 0100 (AI connections) and 0101 (calendar links) were each run right after their merge with the owner's word. Readiness reported ready on 29 Oct after #337, and it reports not ready while any shipped migration is pending (unless that check itself could not run).

**Switched off or not configured (production readiness, 29 Oct, after #337):** deployment mode controlled_pilot; malware scanning unconfigured; redacted download disabled; payments unconfigured; real applicant data disabled; commercial claims disabled. Also off until the owner acts: staff authenticator codes (`STAFF_SECOND_FACTOR`), the AWS key service (O16), backup pruning (`BACKUP_PRUNE`), the AI training guard (owner decision).

**In progress, not live:** S23 real redaction (ADR 0022): safe copies of PDFs and images with masks the owner places, suggested from the PDF's text positions and a passport's machine-readable band. It is not merged, and its migration 0102 needs the owner's word after the merge. Until it lands, readiness keeps redacted download disabled.

**Open:** malware scanning switch-on; staff two-step sign-in acceptance; independent document and key recovery; a real AI app connection test; a named payment provider; the penetration test deferral record (H01); real applicant data and the final release (S24 with WP-V6, owner's explicit word); Bangla (deferred). Pending owner steps: [owner actions](../roadmap/OWNER-ACTIONS-SMALL-COMMERCIAL-V1.md). Evidence for each merge: [known issues](../commercial-v1/known-issues.md).

**Afternoon update, 29 Oct 2026** (supersedes the "In progress" line above):

- **Live:** S23 real redaction is merged (#339, `07d65797`) and its migration 0102 was applied on 29 Oct with the owner's word. Two live fixes followed: #340 (`db5a52c4`) declares the image libraries in the web app, which made document previews and safe copies work in production again, and #341 (`424e525d`) gives safe copy files opaque storage keys and makes the sign-up confirmation page remember the address that was entered. Safe copies can be prepared and downloaded.
- **In progress, not live:** S17 recurring invoices, reminders, overdue handling and reactivation (ADR 0020 Phase 2). It adds migration 0103, which runs only on the owner's word after the merge. Automatic Grace and Suspended stays off until the owner sets the policy (O13).

**Update, 30 Oct 2026** (supersedes the "In progress" line above):

- **Live:** S17 recurring invoices, reminders, overdue handling and reactivation is merged (#342, `aaa29e34`) and its migration 0103 was applied on 29 Oct with the owner's word (run 40894153710). Automatic Grace and Suspended stays off until the owner sets the policy (O13).
- **In progress, not live:** S18 refunds, credits from held payments, refunds made outside VisaStack and the monthly accounting file (platform owner only), with migration 0104 on the owner's word after the merge; live gateway refunds also need O6 and O18. Alongside it, a fix for the `/auth/reauth` production error.

**31 Oct 2026, live readiness read and PDF intake (ADR 0024):** the fallback address reported `aiExtraction` available, `redactedDownload` available, `aiConnector` available, `malwareScanning` unconfigured, `payments` unconfigured, `realApplicantData` disabled and `commercialClaims` disabled. This settles the mixed lines above: AI reading and Safe Copies are configured and on; the "unconfigured" and "disabled" wording for them is older. PDFs are now admitted on the built-in checks with the scan record saying content is unverified, `PDF_UPLOADS=off` stops them, and the scanner gate can be deferred as H20. Real applicant data stays disabled until every other operational gate is true. Not verified: a PDF read and approved on the live site after this change.
