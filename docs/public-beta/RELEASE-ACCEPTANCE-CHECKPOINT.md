# Public-beta release acceptance checkpoint

2026-10-11. This is preparation, not the final release-candidate approval.

Current classification: **BETA_BLOCKED** for public use with sensitive applicant data. Existing controlled-pilot operation with synthetic data may continue; this does not assert LIMITED_BETA_ONLY acceptance or BETA_READY. No candidate SHA has been nominated.

## Evidence established

- PR 191: 390845818e9546e9776a1abbcb78ad44bc655d71, required CI/deployment checks, canonical aliases, readiness and existing-account feedback. Actual newly branded email remains untested.
- PR 192: c18bbda2f905105fce269a72b7fc6717d9be837b, required CI/deployment checks and [actual isolated database restore](https://github.com/sadatnitex/visastack/actions/runs/38128672220). Complete document/key/lifecycle disaster recovery remains unverified.
- PR 193: verified merge 535c91977126a80a47449fc6aa1d17a86b6cfac2 passed all required source/main and deployment checks. Both production aliases are ready and protected job routes refused anonymous access. Actual scheduler timing and application delivery remain unverified.
- Synthetic service and browser tests exercise guards; they do not complete authenticated production-like journeys J01-J25. The existing acceptance matrix remains authoritative for whole-journey results.

## Required closure evidence

| Area | Required evidence before a public-data release | Current gap |
| --- | --- | --- |
| Identity and privileged access | Synthetic authenticated accounts, MFA/lifecycle, owner continuity and cross-tenant denials | Complete staging journeys and privileged assurance |
| Mail | Consenting fixture inbox, actual verification/reset branding, durable application notice and signed receipt | Configured Auth SMTP is separate from application delivery; provider/sender/receipt settings are incomplete |
| Jobs and capacity | Authorized deployed scheduler, measured backlog/retry/outage timing and current free-plan limits | R2 keys do not grant Workers deployment; intake runner cost needs review |
| Documents and encryption | Real approved scanner path, private upload/read denials, encryption and key rotation/recovery | Complete scanner/key/lifecycle acceptance |
| Intelligence | Human-reviewed maintained sources, applicability/readiness, approved model/privacy and fallback | Source records are not legal sign-off; actual AI-provider/privacy acceptance remains unverified |
| Founder controls | Actual usage, invoices, free allowances, alerts, founding no-charge and identity-preserving upgrade | Missing readings must remain unavailable, not zero |
| Recovery | Consistent database/files/keys/audit/tombstone/revocation restore and measured recovery objectives | Database-only restore passed; full recovery and 15-minute RPO remain open |
| Release | Isolated staging, complete journeys, security, realistic performance, legal/privacy review, exact SHA and rollback | No final candidate is nominated |

## Owner and provider action checklist

1. Prepare and verify authorized isolated staging fixtures and consenting inboxes for J01-J25. Keep real applicant data out of this rehearsal.
2. Confirm application mail sender/provider and signed-event credentials through secure configuration, then review pending notices before delivery activation. Never paste keys into issue text.
3. Authorize a free-plan-compatible scheduler account and provide Workers management access securely if the optional Worker is selected. Review Actions minutes before enabling intake polling.
4. Approve actual requirement content and any AI model, data processing/privacy terms and cost limits. Manual routes remain available meanwhile.
5. Resolve document recovery, key escrow/rotation, retention/deletion and measured backup objectives. Existing weekly backup does not meet a 15-minute RPO.
6. Provide current provider allowances/invoices and legal/privacy decisions. Safely reconcile Neon capacity with all deployment/Auth dependencies before deleting any branch.

## Candidate and rollback record

A later final record must include the exact immutable source SHA and deployed SHA, every required check result and artifact, environment/fixture identifiers, failed or skipped acceptance, migration status, domains, classification and owner approval. Do not infer green from another commit or substitute a readiness response for a user journey.

For a UI/service rollback, select the last verified production deployment, confirm its domain aliases and environment compatibility, and rerun readiness, protected-route and changed-behavior checks. This continuation makes no schema migration. Do not restore a production database or undo encrypted records as an application rollback. Record who performed the rollback and its exact deployment. Keep real-data gates closed until the explicit final release decision.


Disclosure review found the public privacy notice still attributed all file storage to Vercel. The continuation names the selected R2 document provider and configured R2 archive storage, preserving the test-pilot, separate-consent and incomplete-recovery statements. Privacy notice version 2026-10-11.1 identifies the correction for future acknowledgements; existing recorded acknowledgements are not rewritten. This factual correction does not complete legal/privacy approval.


## Current continuation, 2026-10-12

The classification remains BETA_BLOCKED for sensitive applicant data. Public registration and synthetic pilot operation are separate from sensitive-data acceptance. PR 197 is a verified implementation release; CF-04 through CF-08 actual authenticated visual/function acceptance remains incomplete. PR 198's source checks and live deployment/aliases/readiness are established, while its initially unstarted GitHub main/deploy checks are being retried following the owner's account fix. A READY Vercel deployment alone does not close this check.

The independent Free staging project now has an Auth endpoint, an empty application schema and pgcrypto. No production data was cloned or migrated. This is not a prepared five-role authenticated staging deployment: synthetic Auth identities, role/record fixtures and independent app/storage processing still need verification. WorkOS staging success or skipped Neon authenticated jobs cannot substitute for those journeys.

Invitation source tests and public account handoffs are separate evidence from actual Neon acceptance, email callback outcomes and inbox receipt. A signed unknown-event callback probe acknowledged a valid signature and refused an invalid signature without modifying any delivery state; it did not send an email or establish actual delivery. Exact release checkpoints and remaining operator work are in DEPLOYMENT-ACTIONS.md and ../operations/invitation-journeys.md.


## Authenticated evidence correction and remaining gate: 2026-10-12

See [the current CF acceptance checkpoint](../uiux/CF-04-09-ACCEPTANCE-2026-10-12.md) for implementation, actual evidence, the first failed diagnostic run and remaining limits. Personal sharing is implemented behind a default-disabled flag and requires reviewed migration 0085 before production activation. The private scanner worker has a free, bounded OCR reader in this candidate. Required checks and actual authenticated acceptance remain separate; sensitive intake is not enabled.
