# Current VisaStack operating guidance

> Current status: [product and verified release state](../public-beta/CURRENT-STATE.md) (its newest dated section wins; 2026-10-29 at this writing). On this page the newest dated update at the end wins where it differs from the text above it. Earlier dated candidate, activation and verification statements below are historical checkpoints, not current operating claims. Original policy and acceptance requirements remain in force.

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
| AI | Existing approved provider settings, consent, budgets and human review; manual paths remain. The read-only AI connector for a person's own AI app is on in production (update 2026-10-29 below) | Environment-key absence does not establish database-managed provider status; actual privacy/provider acceptance is still owed |
| Jobs | Durable queues, existing protected endpoints, daily fallback and upload-driven processing; optional Worker for more frequent triggers | Worker management access, measured timing and free-plan/runner headroom remain unverified |
| Backup | Daily encrypted pg_dump through Actions to R2 (since 2026-10-29, was weekly; update below); backup encryption key is separate from application key | Daily capture does not meet the unchanged 15-minute RPO |

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


## Current deployment, staging and queue checkpoint, 2026-10-12

PR 198's exact production deployment and both aliases are live and ready, with current compact navigation styling and real applicant intake disabled. Required source checks passed. Required main/deployment checks were initially refused before job startup by GitHub account payment/spending limits. The owner reported the issue fixed; the exact failed runs were retried. Do not treat this as a test failure or waive the current-SHA checks. The invitation candidate remains gated on completed verification.

Isolated staging is now a separate Free Neon project, independent Auth endpoint, empty application schema and pgcrypto, without a production clone or production migration. Its unused compute was explicitly suspended. Five real synthetic Auth identities, role/record fixtures, application binding and isolated storage/processing remain unfinished. The GitHub connection cannot currently manage Actions secrets; configured database access does not imply those permissions. Use supported environment networking and TLS trust; never bypass the session proxy or copy credentials into files/logs.

The application email backlog was empty at configuration review. Production has the verified VisaStack sender and encrypted webhook secret saved; the live callback accepted a correctly signed unknown event and refused an invalid signature without applying a delivery event. Real inbox receipt remains untested. Distinguish team email-bound acceptance from current client token-holder acceptance, and existing personal sharing from account-registration invitations. Details: invitation-journeys.md.


## Document reading and isolated acceptance continuation: 2026-10-12

See [the current CF acceptance checkpoint](../uiux/CF-04-09-ACCEPTANCE-2026-10-12.md) for implementation, actual evidence, the first failed diagnostic run and remaining limits. Personal sharing is implemented behind a default-disabled flag and requires reviewed migration 0085 before production activation. The private scanner worker has a free, bounded OCR reader in this candidate. Required checks and actual authenticated acceptance remain separate; sensitive intake is not enabled.

### Private scanner and storage verification

The existing `Private document scanning and processing` workflow has two manual modes on main: `process-queue` (the unchanged default) and `verify-synthetic`. Both retain the DOCUMENT_INTAKE_ENABLED gate. Configure repository Actions variables DOCUMENT_INTAKE_ENABLED=true and INTAKE_STORAGE_PROVIDER=r2; retain INTAKE_DATABASE_URL for the production visastackdev database, BLOB_READ_WRITE_TOKEN for the existing private mirror, and the verified R2 endpoint/access secrets. The mirror is intentional and must not be removed to bypass configuration.

Before certifying scanner/storage acceptance, run verify-synthetic on the reviewed main revision. It installs fresh official ClamAV signatures, streams synthetic controls through the real storage adapters and scanner, checks native PDF extraction, verifies both storage copies and removes only its own opaque keys. It uses temporary in-memory metadata and never connects to the production database. Require the actual scanning/control steps to pass; a skipped worker is not acceptance. The in-cloud test container has no official definitions and is not production scanner proof.

The R2 byte path exposed a Buffer incompatibility in the PDF parser. Extraction, preview and size checks normalize the exact supplied bytes into Uint8Array, preserving stored bytes and hashes. Production data intake remains disabled pending complete acceptance and owner sign-off.

Update 2026-10-25: branch previews are off (apps/web/vercel.json deploys main only), so there are no current previews and no preview databases for new pull requests. Mentions of preview readiness above are historical. Pull requests run the browser and smoke checks in `.github/workflows/pr-browser-checks.yml` on the CI machine; real-environment checks run after each production deployment.

Update 2026-10-26:
- Neon Auth is the only sign-in system since #237; `IDENTITY_PROVIDER` may be blank or `neon_auth` (any other value is refused and reported by readiness), and the unused `WORKOS_*` variables in Vercel can be deleted by the owner. Mentions of a retained WorkOS path above are historical.
- Production has 90 migrations applied (through 0089). Migrations still run only through `db-migrate.yml` with the owner's word for that specific run, and code must tolerate a new table missing in the minutes between deploy and migration.
- The web app now depends on `sharp` (a native image library) for profile photos and visa photo sizes; it is kept external in `apps/web/next.config.mjs` so the deployed function loads its platform binary. After merging main into a working copy, run `pnpm install` before checking.
- AI: provider switching lives in `/app/admin/ai-settings`. Record each provider's data terms there before or when switching; see [the switching runbook](runbooks/switch-ai-provider.md). The training guard is off by owner decision.
- Renovate is installed by the owner but has not yet opened its Dependency Dashboard; check that the app's installation includes this repository.


Update 2026-10-29 (S13 to S16, connector switched on):
- AI connector: the owner set `AI_CONNECTOR_ENABLED=true` in Vercel Production on 28 Oct. The connector address is `https://vs.obsidianglobal.studio/mcp`; a person adds it in their own AI app (Claude or ChatGPT), signs in to VisaStack and chooses what the app may read (ADR 0021). Checked live: `/.well-known/oauth-authorization-server` answers and readiness reports `aiConnector` available. Not verified: a real Claude or ChatGPT connection end to end. Setting the variable to anything other than `true` turns the connector off.
- `SUPPORT_EMAIL` is set in Vercel Production by the owner. Its value, like every secret or address in configuration, is never written in docs.
- Migrations: the repository holds 100 migrations, up to 0101 (0098 and 0099 are unused numbers). Verified 29 Oct 2026 on Neon (project long-sun-23747504, database visastackdev): `drizzle.__drizzle_migrations` holds 100 rows, so every shipped migration through 0101 is applied. 0100 (AI connections) and 0101 (calendar links) were run in production right after their merges, each with the owner's word for that run. Readiness reported ready on 29 Oct after #337; it reports not ready while any shipped migration is pending (unless that check could not run). The "90 migrations" line in the 2026-10-26 update is historical. Next: 0102 (S23 redaction masks, in progress), which needs the owner's word after its merge.
- Production readiness on 29 Oct after #337: status ready, deployment mode `controlled_pilot`, `malwareScanning` unconfigured, `redactedDownload` disabled, `payments` unconfigured, `aiConnector` available, `realApplicantData` disabled, `commercialClaims` disabled.

Update 2026-10-29 (S27):
- Backup: the encrypted database backup now runs daily at 05:17 UTC instead of weekly, so the independent copy is at most about a day old, and the freshness check runs daily at 11:07 UTC with a 24-hour window, so one failed capture is caught the same day. Automatic pruning (35 days plus 12 weekly copies, never the newest 7) is built but off until the owner sets the repository variable `BACKUP_PRUNE=on`; until then nothing is deleted. Details: [r2-encrypted-backups.md](r2-encrypted-backups.md) ("Daily SQL capture and retention"). The 15-minute recovery point target is still not met.
- Commercial readiness: the AI gate is now provider-neutral (`productionAiProvider`), the scanner gate accepts the private scan runner with fresh proof on the production site (logos and photo proofs of payment are now re-encoded on the server, so only image data is stored), and the external penetration test may be deferred by the owner under H01 only. Details and the attestation evidence list: [pilot-to-commercial-activation.md](pilot-to-commercial-activation.md) ("Readiness reconciliation").
- Readiness gate details (S27, #337): `productionAiProvider` passes when AI dispatch is off, or when the active provider and any fallback the app would really use each have a key and recorded data terms. The only gate the owner may defer is the external penetration test, with `COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST=H01` in Vercel Production (not set at this writing); it then shows as "Deferred by Owner (H01)". The 11 `COMMERCIAL_READINESS_ATTEST_*` values the owner may set, each with its evidence, are listed once in `COMMERCIAL_READINESS_ATTESTATIONS` (`apps/web/src/lib/commercial-readiness.ts`) and in pilot-to-commercial-activation.md. Test scope for the deferred penetration test: [docs/security/external-penetration-test.md](../security/external-penetration-test.md).
- `BACKUP_PRUNE` is a GitHub repository Actions variable (not a Vercel variable). Not set at this writing, so pruning only reports.

Update 2026-10-30 (S18, not merged yet):
- `PAYMENT_REFUNDS_VIA_GATEWAY` (Vercel Production, exactly `true` to turn on; off by default): lets VisaStack send refunds to SSLCOMMERZ. Set it only after the server's fixed outbound address is registered with SSLCOMMERZ (owner action O18) and the live store credentials are in place (O6). While it is off, refunds are made in the SSLCOMMERZ merchant panel and recorded in VisaStack ("Record a Refund Made Outside VisaStack"); sent refunds are still checked daily. Runbook: `docs/operations/refunds-and-ledger-export.md`.

Update 2026-10-30 (OPS-1, lighter live checks and a Render fallback):
- Why: Vercel paused production until 29 Nov 2026 (every request answers 402 DEPLOYMENT_DISABLED) for going over the Hobby plan's "Fluid Active CPU" fair-use limit. Most of that CPU came from our own GitHub workflows checking the live site after each merge: in about a day and a half, 29 Playwright Deploy Smoke runs (about 300 browser tests each), 28 Deploy Smoke runs and 10 live signed-in checks. While paused, none of the 21 Vercel scheduled jobs run (billing, backups check, reminders, notifications, retention).
- Post-merge production checks are now a light subset. Playwright Deploy Smoke runs only the 8 tests tagged `@live` (home, sign-in, a protected page redirect, the security policy, the security headers, a real 404, readiness, one phone-width layout): measured locally through a counting proxy against the production image: 33 app requests plus 70 static files per run, against 1,245 app requests plus 2,603 static files for the full 310 tests that ran before. Deploy Smoke keeps its 8 light requests, once per deployment (the extra "skipped" run each deployment shows is Vercel's earlier pending status, which never reaches the site). The live signed-in check runs at most once per production deployment and has no schedule; a newer deployment cancels its older run of the same kind, and a run started by hand is never cancelled by a deployment run. The smoke and browser checks are never cancelled or queued away: every deployment keeps its own result and release record. Check names are unchanged, and pull requests still run every browser test and the smoke check on GitHub's machine, unchanged. `scripts/live-checks.test.mjs` fails if the production run loses `--grep @live` or more than 12 tests carry the tag.
- Render fallback, ready to switch on: [render-fallback.md](render-fallback.md). A container image built by hand (`render-image.yml`, manual, main only) runs on Render's free plan at the same address; the `render-cron.yml` workflow calls the same jobs on the same schedules and stays off until the repository variable `CRON_HOST=render` is set. The image sets `HOSTING_PLATFORM=render`; the Render service must also have `NEXT_PUBLIC_APP_URL`, or readiness reports not ready. On Vercel neither is needed and behaviour is unchanged. The cron workflow also skips every job when Vercel (not paused) is serving the public address. Not yet done: creating the Render service, a real sign-in, upload and job run there.

Update 2026-10-30 (S29, launch switches in one place):

Every setting that turns a launch capability on, where it lives and how it is read. On/off switches are read by one rule (`switchOn`, S29): on only for `true`, spaces around it ignored; anything else or nothing is off. Values are never written in docs.

| Capability | Switch (where) | Off / not set | On | Notes |
|---|---|---|---|---|
| Online payments | `PAYMENT_PROVIDER=sslcommerz` with `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_MODE` (Vercel Production) | Not set up; agencies report payments, staff record them | `sandbox`: Test Payments Only (owner only, labelled Test Payment, left out of the accounting file). `live`: real money | Owner decisions O6, O14 (SSLCOMMERZ with bKash, Rocket, Nagad in its checkout). Mode shown on Billing Rules, status page, platform overview |
| Refunds through the gateway | `PAYMENT_REFUNDS_VIA_GATEWAY` (Vercel Production) | Refunds made in the merchant panel and recorded in VisaStack | VisaStack sends refunds to SSLCOMMERZ | Needs the fixed outbound address registered (O18) |
| Application email | `EMAIL_PROVIDER=resend` with `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` (Vercel) | No application email | Notices sent | Delivery receipts need `RESEND_WEBHOOK_SECRET` |
| Virus scanning | `MALWARE_SCANNER_PROVIDER` (Vercel) | Readiness says scanning is not configured | Uploads scanned | O4 |
| Encryption keys | `KMS_PROVIDER` with its key settings (Vercel) | Local key | Key service | O5, O16 |
| AI provider | `AI_PROVIDER` with its key; Admin > AI Settings | AI reading off | Suggestions people approve | Data terms recorded in AI Settings |
| AI connector | `AI_CONNECTOR_ENABLED` (Vercel) | Connector addresses answer 404 | People connect their AI apps | On in Production since 28 Oct |
| AI features | Admin > Settings > AI Features (database) | Each feature at its standard setting | Per feature, with a daily limit | Limits per person also come from the traveller plan (Plans page) |
| Personal sharing invitations | `PERSONAL_SHARING_INVITATIONS_ENABLED` (Vercel) | Sharing with existing accounts only | Invitations to people without an account | |
| Case retention purge | `CASE_RETENTION_PURGE_ENABLED` (Vercel) | Notices only | Old cases purged after grace | |
| Inactive account deletion | `INACTIVE_ACCOUNT_DELETION_ENABLED` (Vercel) | Notices only | Inactive accounts deleted after grace | |
| Readiness attestations | `COMMERCIAL_READINESS_ATTEST_*` (Vercel) | Commercial readiness not claimed | Each attested gate passes | Owner attests only what was verified |
| Billing rules | Admin > Settings > Billing Rules (database) | Invoices and reminders only | Automatic Grace and Suspended | O13 decided: Grace 7, Suspended 30 days after the due date; set by the owner on the page |
| Plans | Admin > Settings > Plans (database) | Plans as they are | Create, price, retire | After migration 0107 (O8-S29). Runbook: [plans-and-entitlements.md](plans-and-entitlements.md) |
| Backup pruning | `BACKUP_PRUNE` (GitHub repository Actions variable) | Reports only | Prunes old backups | Approved 30 Oct 2026; waiting for the owner to set `on` |

Correction 2026-10-30 (S29 round 2): the launch-switch table above says every switch is read by one rule. That is withdrawn: each switch keeps the reading it had before S29. Exactly `true` (no spaces, lower case): `PAYMENT_REFUNDS_VIA_GATEWAY`, `PERSONAL_SHARING_INVITATIONS_ENABLED`, `CASE_RETENTION_PURGE_ENABLED`, `INACTIVE_ACCOUNT_DELETION_ENABLED`, `COMMERCIAL_READINESS_ATTEST_*`, `AI_ENABLED`, `OPENAI_STORE_RESPONSES`. Spaces around it ignored, then `true`: `AI_CONNECTOR_ENABLED`. `BACKUP_PRUNE` is read by its workflow as `on`. Pinned by `apps/web/src/lib/launch-switch-parsing.test.ts`. Online payment in test mode is shown to agencies as "being tested"; only the platform owner sees Pay Online until the gateway is live.
