# Current VisaStack operating guidance

Updated 2026-10-11. Start here for current deployment and setup facts. Earlier runbooks remain historical records; their provider, automatic-migration, email-linking and recovery claims are superseded where they conflict with this page. Original security and acceptance targets still apply.

## Product and access

Canonical production: https://vs.obsidianglobal.studio. The verified fallback alias is https://visastack-five.vercel.app. Preview addresses must resolve to their exact reviewed READY deployment and use the actual Git branch ref for scoped settings. Do not substitute an old deployment address or use a commit SHA as a branch ref.

Production remains controlled pilot. Use synthetic applicant records and documents. Registration availability is separately configured; a confirmed email or a public registration screen does not activate sensitive-data intake, certify complete features or grant agency access. The programme is BETA_BLOCKED for public sensitive-data use pending [release acceptance](../public-beta/RELEASE-ACCEPTANCE-CHECKPOINT.md).

Neon Auth is the configured production sign-in service through IDENTITY_PROVIDER=neon_auth. The code retains an explicitly selected legacy WorkOS path and historical references; do not delete them or claim the default has been changed. Current identity continuity requires a trusted immutable subject and the existing binding rules. Matching email, confirming email or resetting a password does not transfer an older account, records or administrator rights.

The existing founder dashboard is /app/admin and requires a current platform role. There is no new universal administrator or replacement identity. Do not grant privileges simply because an email appears in a configuration list. A missing legacy WorkOS reference does not mean a Neon account's current sign-in is broken.

## Current infrastructure

| Area | Current guidance | Evidence boundary |
| --- | --- | --- |
| Database | Neon, pooled transaction-capable application driver; unpooled TLS backup connection | No production migration is implicit in a deployment |
| Protected fields | Native pgcrypto write setting PROTECTED_FIELDS_PGCRYPTO=required | Key recovery/rotation and full real-data acceptance remain required |
| Files and archives | Private R2 bucket visastack-document-backups, EU account endpoint, path-style S3 access, R2_REGION defaults to auto | Configured storage is not permission, malware or complete recovery proof |
| Authentication mail | Neon Auth SMTP, application name VisaStack, approved sender noreply@vs.obsidianglobal.studio | A delivered-server status is not inbox placement; new branded mail rendering remains untested |
| Case/workspace mail | Existing Resend adapter; EMAIL_PROVIDER=resend, key, verified sender and signed webhook required | Auth SMTP does not configure application delivery; queued messages must be reviewed before activation |
| AI | Existing approved provider settings, consent, budgets and human review; manual paths remain | Environment-key absence does not establish database-managed provider status; actual privacy/provider acceptance is still owed |
| Jobs | Durable queues, existing protected endpoints, daily fallback and upload-driven processing; optional Worker for more frequent triggers | Worker management access, measured timing and free-plan/runner headroom remain unverified |
| Backup | Weekly encrypted pg_dump through Actions to R2; backup encryption key is separate from application key | Weekly capture does not meet the unchanged 15-minute RPO |

The successful [isolated restore run 38128672220](https://github.com/sadatnitex/visastack/actions/runs/38128672220) authenticated the stored archive and restored only a private temporary database. This proves database-only recovery. It does not recover document objects, application keys, audit checkpoints, deletion tombstones or revoked access, and does not prove end-to-end RPO/RTO. Never restore into production as an application rollback.

## Configuration and deployment

Keep production values unscoped to a Git branch. A branch-specific Vercel variable belongs only to Preview. Create a separate production entry rather than attaching Production to a branch-specific variable. The R2 jurisdiction endpoint and region setting are separate: auto does not replace the EU account endpoint.

The current application build is next build. Production migrations require explicit authorization for that specific run; older automatic-build migration instructions are superseded. Public readiness exposes a coarse result and platform states, never secret values or detailed provider/operational configuration. Protected administrator pages carry detailed diagnostics.

Before a merge, verify required CI on the exact source SHA. After deployment, verify the merge SHA, required main checks, both deployment smoke workflows, exact READY deployment, aliases, readiness and the changed behavior. A preview readiness result does not prove staging database isolation or authenticated acceptance. Current staging test-account configuration and preview binding proof remain incomplete.

Neon capacity must remain below ten branches. Protect production/default, current previews, staging, open work, Auth references, child branches and recovery data. Current inspection found ten branches, with opaque bindings preventing proof that a candidate is unnecessary. No branch was deleted or created by the restore drill or documentation refresh. Never delete by age/name alone.

## Communications and upgrades

Use VisaStack as the product name and the canonical production address for production links. Preview messages/links must use the actual preview origin. Password recovery shows a check-email confirmation and an explicit resend option with existing rate limits. Existing-account signup offers sign-in/reset guidance. Do not claim provider acceptance guarantees receipt or that a password reset grants old records.

Privacy notice version 2026-10-11.1 names the selected document provider and configured R2 archives; terms version remains 2026-10-10.1. Both await legal review. Prior acknowledgements and already delivered messages remain historical records. Registration notice acknowledgement is separate from marketing, AI and agency-sharing consent.

Founding access stays complimentary. Actual provider bills, allowances and account usage must be measured before an upgrade. Missing cost or capacity readings are unavailable, not zero or unlimited. See [cost register](../public-beta/PROVIDER-COST-REGISTER.md), [upgrade procedure](free-to-scale-upgrades.md) and [remaining owner/provider evidence](../public-beta/OWNER-ACTIONS.md).

### 2026-10-11 PDF fidelity correction checkpoint

The latest corrective owner mandate uses the uploaded ten-page PDF for composition and the approved flat refinement. Earlier HTML palette/device-theme checks do not establish full PDF or authenticated functional acceptance. The [reference checkpoint](../uiux/REFERENCE-FIDELITY-CHECKPOINT.md) records the complete baseline route/control inventory, reference-to-function mapping and package status. Contextual navigation changes preserve existing owned-record, active-membership and platform-role boundaries; they do not establish new permissions. Final isolated authenticated screenshots and journeys remain unverified.


## Invitation delivery candidate, 2026-10-12

Team and client invitation creation previously returned a link without sending email. The follow-up candidate wires email-only recipients into the existing durable outbox, encrypts the usable invitation link, adds copy/native sharing and preserves the invitation through Neon signup and confirmation. Existing team accounts still use the current immediate-add policy and now receive membership notices. Phone-based client contacts need manual link sharing. See [invitation journeys](invitation-journeys.md) for exact acceptance and policy differences. Production delivery configuration and backlog review are tracked separately from source tests; neither queued nor provider-accepted messages prove inbox receipt.


Production configuration checkpoint, 2026-10-12: the pending application email queue was empty at review. The existing Resend key has management access, and vs.obsidianglobal.studio is verified. EMAIL_PROVIDER=resend and the approved branded sender have been saved for Production. An enabled Resend webhook for delivery, bounce, complaint and failure events was registered on the existing application endpoint; its signing secret was saved as an encrypted Production variable. These settings activate with the next deployment. No real invitation email or inbox-receipt test was sent as part of configuration.
