# Documentation and communications reconciliation

2026-10-11. The owner asked to update long-standing documentation, public copy and private communications. Current operation is controlled pilot with sensitive-data release BETA_BLOCKED; this register is not final release approval.

## Current communications

| Surface | Result | Verification boundary |
| --- | --- | --- |
| Product branding and public domains | VisaStack; canonical https://vs.obsidianglobal.studio with verified Vercel fallback; preview origin follows its actual branch deployment | Exact deployment/domain checks remain required after each release |
| Signup and password recovery | Existing-account sign-in/reset guidance; check-email confirmation and explicit resend with existing rate limits | Prior deployed guidance verified; complete authenticated lifecycle acceptance remains |
| Public privacy and terms | Selected document provider and configured R2 archives; privacy version 2026-10-11.1, terms 2026-10-10.1 | Synthetic disclosure tests pass; legal review remains open |
| Private founder access report | Legacy sign-in references are distinguished from a working Neon identity | Copy tests and unchanged permission/data paths; authenticated live rendering remains unverified |
| Authentication emails | Neon Auth application name is VisaStack; approved sender is noreply@vs.obsidianglobal.studio | Configuration verified previously; fresh branded receipt/inbox rendering remains untested |
| Application notifications | Existing event-specific subject and summary use the private provider and correct app origin; no obsolete NeonSadat literal was found in application templates | Sender/provider and signed delivery activation remain separate from Auth SMTP; no test email was sent |
| Operator instructions | Current guide corrects provider, migration, readiness, recovery and staging assumptions | Historical requirements and audit evidence remain intact |

Changes to wording do not rewrite delivered emails, provider-history events, old acknowledgements or audit records. Configuration presence does not prove delivery or operational acceptance. No contact address, invoice, free allowance, assurance or privacy approval is invented.

## Inventory and disposition

The initial inventory reviewed 128 Markdown documents plus six retained evidence/reference files. Repository README and private CLAUDE instructions are also updated. Original visual reference/evidence artifacts retain their appearance and meaning. A dated current operating correction was appended to 64 documents with earlier provider/domain assumptions; append-only evidence logs receive their own new entries. Other documents were reviewed for these stale references and retained. Current guidance is [the operating guide](../operations/current-platform.md), [the product contract](PRODUCT-CONTRACT.md) and [release acceptance](RELEASE-ACCEPTANCE-CHECKPOINT.md).

| Document | Disposition |
| --- | --- |
| [docs/README.md](../README.md) | Dated operating correction appended; original content retained |
| [docs/adr/0000-template.md](../adr/0000-template.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0001-record-architecture-decisions.md](../adr/0001-record-architecture-decisions.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0002-remote-first-delivery.md](../adr/0002-remote-first-delivery.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0003-monorepo-turborepo-pnpm.md](../adr/0003-monorepo-turborepo-pnpm.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0004-typescript-strict.md](../adr/0004-typescript-strict.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0005-toolchain-biome-vitest.md](../adr/0005-toolchain-biome-vitest.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0006-identity-workos.md](../adr/0006-identity-workos.md) | Dated operating correction appended; original content retained |
| [docs/adr/0007-provider-stack.md](../adr/0007-provider-stack.md) | Dated operating correction appended; original content retained |
| [docs/adr/0008-persistence-drizzle-pglite.md](../adr/0008-persistence-drizzle-pglite.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0009-service-layer-transactional-driver.md](../adr/0009-service-layer-transactional-driver.md) | Dated operating correction appended; original content retained |
| [docs/adr/0010-document-pipeline-ai-gateway-ports.md](../adr/0010-document-pipeline-ai-gateway-ports.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0011-neon-bytea-storage-and-structural-scanner.md](../adr/0011-neon-bytea-storage-and-structural-scanner.md) | Dated operating correction appended; original content retained |
| [docs/adr/0012-conservative-pdf-handling.md](../adr/0012-conservative-pdf-handling.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/adr/0013-transactional-email-resend.md](../adr/0013-transactional-email-resend.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/architecture/ai-gateway.md](../architecture/ai-gateway.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/architecture/data-model.md](../architecture/data-model.md) | Dated operating correction appended; original content retained |
| [docs/architecture/document-pipeline.md](../architecture/document-pipeline.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/architecture/overview.md](../architecture/overview.md) | Dated operating correction appended; original content retained |
| [docs/architecture/permission-model.md](../architecture/permission-model.md) | Dated operating correction appended; original content retained |
| [docs/audits/ai-gateway-boundary-map.md](../audits/ai-gateway-boundary-map.md) | Dated operating correction appended; original content retained |
| [docs/audits/applicant-core-document-to-profile-boundary-map.md](../audits/applicant-core-document-to-profile-boundary-map.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/audits/commercial-readiness-recovery-baseline.md](../audits/commercial-readiness-recovery-baseline.md) | Dated operating correction appended; original content retained |
| [docs/audits/current-product-baseline.md](../audits/current-product-baseline.md) | Dated operating correction appended; original content retained |
| [docs/audits/exact-sha-ci-e2e-verification-boundary-map.md](../audits/exact-sha-ci-e2e-verification-boundary-map.md) | Dated operating correction appended; original content retained |
| [docs/audits/final-programme-verdict.md](../audits/final-programme-verdict.md) | Dated operating correction appended; original content retained |
| [docs/audits/integration-and-cleanup-map.md](../audits/integration-and-cleanup-map.md) | Dated operating correction appended; original content retained |
| [docs/audits/missions-packs-collaboration-boundary-map.md](../audits/missions-packs-collaboration-boundary-map.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/audits/post-programme-defect-register.md](../audits/post-programme-defect-register.md) | Dated operating correction appended; original content retained |
| [docs/audits/readiness-provider-disclosure-boundary-map.md](../audits/readiness-provider-disclosure-boundary-map.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/architecture-decisions.md](../commercial-v1/architecture-decisions.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/assumptions-and-blockers.md](../commercial-v1/assumptions-and-blockers.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/asvs-l2-map.md](../commercial-v1/asvs-l2-map.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/baseline.md](../commercial-v1/baseline.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/cost-and-vendor-register.md](../commercial-v1/cost-and-vendor-register.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/commercial-v1/final-report.md](../commercial-v1/final-report.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/free-stack-launch-plan.md](../commercial-v1/free-stack-launch-plan.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/handover-inventory.md](../commercial-v1/handover-inventory.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/known-issues.md](../commercial-v1/known-issues.md) | Append-only evidence updated |
| [docs/commercial-v1/neon-auth-migration-plan.md](../commercial-v1/neon-auth-migration-plan.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/part-10-acceptance-matrix.md](../commercial-v1/part-10-acceptance-matrix.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/part-10-journeys.md](../commercial-v1/part-10-journeys.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/part-10-reread.md](../commercial-v1/part-10-reread.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/commercial-v1/part-10-security-scans.md](../commercial-v1/part-10-security-scans.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/commercial-v1/part-10-signoffs.md](../commercial-v1/part-10-signoffs.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/part-9-checkpoint.md](../commercial-v1/part-9-checkpoint.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/commercial-v1/privacy-data-map.md](../commercial-v1/privacy-data-map.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/release-gate.md](../commercial-v1/release-gate.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/commercial-v1/requirements-ledger.md](../commercial-v1/requirements-ledger.md) | Append-only evidence updated |
| [docs/commercial-v1/supersession-map.md](../commercial-v1/supersession-map.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/test-evidence.md](../commercial-v1/test-evidence.md) | Dated operating correction appended; original content retained |
| [docs/commercial-v1/threat-model.md](../commercial-v1/threat-model.md) | Dated operating correction appended; original content retained |
| [docs/governance/autonomous-engineering-qa-protocol-2026-10-10.md](../governance/autonomous-engineering-qa-protocol-2026-10-10.md) | Dated operating correction appended; original content retained |
| [docs/governance/branch-protection.md](../governance/branch-protection.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/governance/delivery.md](../governance/delivery.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/governance/integration-and-cleanup-directive.md](../governance/integration-and-cleanup-directive.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/governance/service-wiring.md](../governance/service-wiring.md) | Dated operating correction appended; original content retained |
| [docs/governance/vercel-setup.md](../governance/vercel-setup.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/backup-resurrection-reconciliation.md](../operations/backup-resurrection-reconciliation.md) | Dated operating correction appended; original content retained |
| [docs/operations/capacity.md](../operations/capacity.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/cloudflare-job-scheduler.md](../operations/cloudflare-job-scheduler.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/database-restore-drill.md](../operations/database-restore-drill.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/free-to-scale-upgrades.md](../operations/free-to-scale-upgrades.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/incidents/README.md](../operations/incidents/README.md) | Dated operating correction appended; original content retained |
| [docs/operations/incidents/access-compromise.md](../operations/incidents/access-compromise.md) | Dated operating correction appended; original content retained |
| [docs/operations/incidents/ai-provider-issue.md](../operations/incidents/ai-provider-issue.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/incidents/data-exposure.md](../operations/incidents/data-exposure.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/incidents/email-notification-issue.md](../operations/incidents/email-notification-issue.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/incidents/restore.md](../operations/incidents/restore.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/incidents/scanner-outage.md](../operations/incidents/scanner-outage.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/incidents/secret-compromise.md](../operations/incidents/secret-compromise.md) | Dated operating correction appended; original content retained |
| [docs/operations/incidents/storage-issue.md](../operations/incidents/storage-issue.md) | Dated operating correction appended; original content retained |
| [docs/operations/incidents/tabletop.md](../operations/incidents/tabletop.md) | Dated operating correction appended; original content retained |
| [docs/operations/monitoring.md](../operations/monitoring.md) | Dated operating correction appended; original content retained |
| [docs/operations/pilot-to-commercial-activation.md](../operations/pilot-to-commercial-activation.md) | Dated operating correction appended; original content retained |
| [docs/operations/private-pdf-intake.md](../operations/private-pdf-intake.md) | Current R2 correction and prominent historical setup warning appended |
| [docs/operations/public-beta-sign-in.md](../operations/public-beta-sign-in.md) | Dated operating correction appended; original content retained |
| [docs/operations/r2-encrypted-backups.md](../operations/r2-encrypted-backups.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/recovery.md](../operations/recovery.md) | Dated operating correction appended; original content retained |
| [docs/operations/release-and-rollback.md](../operations/release-and-rollback.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/operations/runbook.md](../operations/runbook.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/product/build-spec-v1.1.md](../product/build-spec-v1.1.md) | Dated operating correction appended; original content retained |
| [docs/product/commercial-v1-prd-2026-09-16.md](../product/commercial-v1-prd-2026-09-16.md) | Dated operating correction appended; original content retained |
| [docs/product/prd-v1.1.md](../product/prd-v1.1.md) | Dated operating correction appended; original content retained |
| [docs/product/public-beta-transformation-directive-2026-10-10.md](../product/public-beta-transformation-directive-2026-10-10.md) | Dated operating correction appended; original content retained |
| [docs/public-beta/DEPLOYMENT-ACTIONS.md](DEPLOYMENT-ACTIONS.md) | Dated operating correction appended; original content retained |
| [docs/public-beta/EXECUTION-CHECKPOINT.md](EXECUTION-CHECKPOINT.md) | Dated operating correction appended; original content retained |
| [docs/public-beta/FEATURE-AVAILABILITY.md](FEATURE-AVAILABILITY.md) | Dated operating correction appended; original content retained |
| [docs/public-beta/IMPLEMENTATION-TRACEABILITY.md](IMPLEMENTATION-TRACEABILITY.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/public-beta/NEON-RESEND-IDENTITY.md](NEON-RESEND-IDENTITY.md) | Dated operating correction appended; original content retained |
| [docs/public-beta/OWNER-ACTIONS.md](OWNER-ACTIONS.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/public-beta/PR02-05-COORDINATED.md](PR02-05-COORDINATED.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/public-beta/PRODUCT-CONTRACT.md](PRODUCT-CONTRACT.md) | Dated operating correction appended; original content retained |
| [docs/public-beta/PROVIDER-COST-REGISTER.md](PROVIDER-COST-REGISTER.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/public-beta/RELEASE-ACCEPTANCE-CHECKPOINT.md](RELEASE-ACCEPTANCE-CHECKPOINT.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/public-beta/SIGNUP-SAFEGUARDS.md](SIGNUP-SAFEGUARDS.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/public-beta/SOURCE-AND-DEPENDENCY-MAP.md](SOURCE-AND-DEPENDENCY-MAP.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/public-beta/TEST-AND-ACCEPTANCE-EVIDENCE.md](TEST-AND-ACCEPTANCE-EVIDENCE.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/roadmap/acceptance-criteria.md](../roadmap/acceptance-criteria.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/roadmap/commercial-recovery-completion-ux-directive.md](../roadmap/commercial-recovery-completion-ux-directive.md) | Dated operating correction appended; original content retained |
| [docs/roadmap/commercial-v1-implementation-directive.md](../roadmap/commercial-v1-implementation-directive.md) | Dated operating correction appended; original content retained |
| [docs/roadmap/master-build-pilot-commercialization-directive.md](../roadmap/master-build-pilot-commercialization-directive.md) | Dated operating correction appended; original content retained |
| [docs/roadmap/phase-plan.md](../roadmap/phase-plan.md) | Dated operating correction appended; original content retained |
| [docs/roadmap/reliability-document-intelligence-upgrade.md](../roadmap/reliability-document-intelligence-upgrade.md) | Dated operating correction appended; original content retained |
| [docs/roadmap/remaining-commercial-blockers.md](../roadmap/remaining-commercial-blockers.md) | Dated operating correction appended; original content retained |
| [docs/security/document-trust-boundary.md](../security/document-trust-boundary.md) | Dated operating correction appended; original content retained |
| [docs/security/durable-jobs-and-upload-integrity-boundary.md](../security/durable-jobs-and-upload-integrity-boundary.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/security/erasure-and-retention-boundary.md](../security/erasure-and-retention-boundary.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/security/identity-and-step-up-boundary.md](../security/identity-and-step-up-boundary.md) | Dated operating correction appended; original content retained |
| [docs/security/supply-chain.md](../security/supply-chain.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/security/tenant-isolation-matrix.md](../security/tenant-isolation-matrix.md) | Dated operating correction appended; original content retained |
| [docs/security/threat-model.md](../security/threat-model.md) | Dated operating correction appended; original content retained |
| [docs/uiux/ACCESSIBILITY-REPORT.md](../uiux/ACCESSIBILITY-REPORT.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/DESIGN-CONTRACT.md](../uiux/DESIGN-CONTRACT.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/EXECUTION-CHECKPOINT.md](../uiux/EXECUTION-CHECKPOINT.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/FINAL-UIUX-RELEASE-REPORT.md](../uiux/FINAL-UIUX-RELEASE-REPORT.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/FUNCTIONAL-NONREGRESSION.md](../uiux/FUNCTIONAL-NONREGRESSION.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/INTERACTION-AND-STATE-MATRIX.md](../uiux/INTERACTION-AND-STATE-MATRIX.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/REFERENCE-MAPPING.md](../uiux/REFERENCE-MAPPING.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/ROUTE-COVERAGE.md](../uiux/ROUTE-COVERAGE.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/TOKENS-AND-COMPONENTS.md](../uiux/TOKENS-AND-COMPONENTS.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/uiux/VISUAL-REGRESSION-REPORT.md](../uiux/VISUAL-REGRESSION-REPORT.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/ux/accessibility.md](../ux/accessibility.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/ux/critical-states.md](../ux/critical-states.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/ux/plain-language.md](../ux/plain-language.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/ux/screen-preview.md](../ux/screen-preview.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/ux/ui-upgrade-report.md](../ux/ui-upgrade-report.md) | Reviewed; no matched stale provider/domain reference requiring replacement |
| [docs/ux/visastack-product-experience.md](../ux/visastack-product-experience.md) | Dated operating correction appended; original content retained |
| [docs/public-beta/SOURCE-INVENTORY.txt](SOURCE-INVENTORY.txt) | Retained evidence/reference artifact; no visual or historical alteration |
| [docs/uiux/evidence/all-ten-desktop.jpg](../uiux/evidence/all-ten-desktop.jpg) | Retained evidence/reference artifact; no visual or historical alteration |
| [docs/uiux/evidence/appearance-parity.json](../uiux/evidence/appearance-parity.json) | Retained evidence/reference artifact; no visual or historical alteration |
| [docs/uiux/evidence/guard-mutations.json](../uiux/evidence/guard-mutations.json) | Retained evidence/reference artifact; no visual or historical alteration |
| [docs/uiux/evidence/navigation-audit.json](../uiux/evidence/navigation-audit.json) | Retained evidence/reference artifact; no visual or historical alteration |
| [docs/uiux/evidence/phone-light-dark.jpg](../uiux/evidence/phone-light-dark.jpg) | Retained evidence/reference artifact; no visual or historical alteration |

## Historical runbook entry points

Eleven setup, migration, recovery, intake and incident runbooks now start with an explicit historical-guidance warning and link to the current operating guide. Their original evidence and acceptance requirements remain intact. Current readers must not follow superseded provider, domain, automatic-migration or email-linking instructions.
