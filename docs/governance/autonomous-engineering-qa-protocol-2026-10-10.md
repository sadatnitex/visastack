# VISAStack  -  Sol Medium Autonomous Engineering & Quality Assurance Protocol

> Owner-supplied execution protocol recorded on 2026-10-10. Applies when implementing the [public beta transformation directive](../product/public-beta-transformation-directive-2026-10-10.md). Recording this protocol does not establish implementation completion.


**This instruction supplements and governs the execution of the entire VisaStack Master Public Beta Implementation Directive. It does not replace its product requirements, business decisions, architecture, security obligations or implementation scope.**

## 1. Fixed execution configuration

The owner has deliberately selected **GPT-6.1 Sol with Medium reasoning effort for the entire implementation** to optimize cost while maintaining exceptionally high engineering standards.

You must not require a model change, higher reasoning effort, or Astra escalation.

Compensate for the fixed reasoning budget through disciplined decomposition, bounded context, explicit invariants, real testing, systematic code review and persistent implementation records.

**Do not compensate by reducing functionality, weakening safeguards, simplifying business rules, skipping tests or leaving difficult integrations unfinished.**

Your target is correctness demonstrated through evidence, not the appearance of completeness.

## 2. Autonomous execution contract

The owner has already approved the product direction and master implementation plan.

Your job is to execute, not repeatedly seek architectural reconfirmation.

1. Read the complete master directive and current repository instructions.
2. Establish the exact current source and deployment baseline.
3. Identify genuine dependencies, risks and existing implementations.
4. Create a compact, executable work graph using the approved PR-00 through PR-09 structure.
5. Implement the work packages in dependency order.
6. Complete source, tests, documentation and verification for each coherent change.
7. Persist results and continue to the next work package wherever feasible.
8. Do not stop after planning, analysis, scaffolding or the first completed task when additional authorized engineering work remains.
9. Do not perform unauthorized production migrations, public activation, destructive changes or paid-plan upgrades.
10. When external access or owner approval is genuinely required, record the blocker, continue independent work and consolidate owner actions.

Do not repeatedly ask the owner what model, reasoning level or implementation method to use.

Do not attempt to execute all PRs in one uncontrolled diff.

## 3. Establish one canonical engineering contract

Create or update a concise repository-maintained implementation contract containing:

- Product vision and founding-access offer.
- Final Neon Auth + Resend decisions.
- Current canonical data model.
- Domain and service boundaries.
- Authorization and privacy invariants.
- Supported user roles and journeys.
- Security and durability requirements.
- Current provider and infrastructure assumptions.
- Future monetization compatibility.
- Explicit non-goals.
- Acceptance requirements.
- Implementation progress and remaining dependencies.

The master directive is authoritative. Existing source is authoritative for understanding current behavior. Neither an older roadmap nor a misleading existing implementation should silently override an explicit new owner decision.

Resolve contradictions explicitly before changing consequential business behavior.

Do not create competing architecture documents or duplicate the entire master prompt into multiple files.

## 4. Small-scope implementation, complete-scope delivery

For every approved PR:

**A. Understand**

Trace the affected UI, Server Action or API, service, policy, persistence, provider and background work.

Identify all callers, downstream dependencies, existing contracts and affected migrations.

Do not modify a service without inspecting the relevant consumers.

**B. Specify**

Define:

- Existing behavior.
- Required behavior.
- Preserved invariants.
- Likely regressions.
- Failure states.
- Data impact.
- Security impact.
- Acceptance tests.

**C. Implement**

Make the smallest cohesive change that fully delivers the required behavior.

Do not rewrite functioning foundations merely because a replacement appears easier.

**D. Verify**

Run focused tests, negative tests and integration checks relevant to the change.

**E. Review**

Inspect the actual diff independently of the original implementation reasoning.

Look for missing checks, incorrect assumptions, unsafe fallbacks, broken callers, migration conflicts and feature drift.

**F. Complete**

Run the appropriate full PR-level verification, record evidence, and proceed.

A package is not complete simply because the primary happy path works.

## 5. Risk-adaptive engineering rigor

Apply more verification to higher-risk changes without changing the model or reasoning effort.

### Critical-risk work

Identity migration, account linking, authentication, authorization, document access, encryption, key management, tenant isolation, retention, deletion and database migration.

Require:

- Threat and abuse-case analysis.
- Exact authorization mapping.
- Transaction and concurrency review.
- Data-preservation analysis.
- Failure-injection tests.
- Adversarial tests.
- Rollback or recovery procedure.
- Production-like integration evidence.
- Explicit assessment of what has not been independently verified.

Where qualified external security assessment is necessary, retain that requirement. A model reviewing its own code is not an independent security certification.

### High-risk work

AI processing, notification delivery, agency collaboration, external storage, provider configuration and financial records.

Require:

- Failure and timeout testing.
- Retry and idempotency verification.
- Provider contract checks.
- Negative authorization scenarios.
- Operational observability.
- User-visible recovery behavior.

### Ordinary implementation work

Presentation, copy, navigation, reporting and routine internal tooling.

Require focused tests, accessibility checks where applicable, accurate data usage and regression verification.

Do not spend the same review budget on a button label and a cryptographic key migration.

## 6. Two-pass code-quality verification

After implementing each work package, perform two distinct reviews.

**Pass 1  -  Contract and correctness**

Check that every required operation works through its full path and that existing functionality still behaves correctly.

Trace data and authorization end to end.

**Pass 2  -  Adversarial and operational**

Attempt to identify how the implementation could fail under:

- Unauthorized access.
- Incorrect identities or stale sessions.
- Simultaneous requests.
- Interrupted uploads.
- Network outages.
- Duplicate webhooks.
- Missing configuration.
- Schema mismatches.
- Provider failure.
- Expired consent.
- Revoked grants.
- Malformed documents.
- Resource exhaustion.
- Partial transaction completion.
- Lost background jobs.
- Failed restores.

For meaningful defects, write a regression test that fails before the fix and passes afterward whenever feasible.

Do not rely solely on self-assessed confidence, simulated test results or comments stating that a problem has been solved.

## 7. Mandatory repository-specific correction list

Inspect these known VisaStack issues early and verify their present status against the actual checkout:

1. WorkOS sign-out still called from the signed-in application layout.
2. WorkOS `withAuth` still used in the public root layout.
3. Identity selection defaults to WorkOS when Neon is not explicitly selected.
4. Existing no-secret/authenticated smoke tests contain WorkOS expectations.
5. Same-commit deployment tests have shown differing identity-provider configurations.
6. `accounts.neon_user_id` migration 0084 was reported applied, but target-environment verification remains necessary.
7. Existing-account linking requires stronger protection than matching a newly verified email address.
8. Privileged-user MFA requires genuine Neon-compatible verification.
9. Public signup terms, privacy and consent are incomplete.
10. `originalDownload` and `redactedDownload` are not fully connected.
11. Migration-readiness logic can accept an unchecked migration state.
12. Commercial readiness still contains WorkOS-specific requirements.
13. Local encryption-key handling is not equivalent to production-grade managed key governance.
14. Real ClamAV processing and independent file backups require operational proof.
15. Date-based reminders and some recovery work depend on once-daily scheduling.
16. Agency plan UI and free-entitlement behavior require review.
17. Published route-pack coverage and actual configured AI-provider availability require verification.
18. `main` branch protection and migration-credential separation require operational review.

This list is a starting hypothesis, not proof that every item remains open.

For each, classify it as:

- Confirmed and fixed.
- Already resolved.
- Configuration-only.
- External approval or provider dependency.
- Still open with documented reason.

Never blindly patch a defect already fixed in the current checkout.

## 8. Prevent feature drift

Before completing any PR, check that the change does not:

- Restrict genuinely available Founding Access functionality unnecessarily.
- Introduce payment requirements.
- Reintroduce WorkOS into live runtime.
- Create a competing account, wallet or case system.
- Weaken existing sharing or tenant isolation.
- Turn AI output into automatic authoritative truth.
- Delete document or historical record provenance.
- Break agency-to-traveller permissions.
- Assume unlimited free infrastructure.
- Make future billing require identity migration.
- Hardcode vendor-specific logic into core domain services.
- Weaken consent, retention or audit controls.
- Expose real data to unapproved providers.
- Introduce needless infrastructure complexity.
- Replace established UX with generic autogenerated layouts.

Preserve the already implemented product breadth.

The objective is to complete and operationalize it, not reduce it to a minimal prototype.

## 9. Engineering economy and context discipline

Use Medium effort intelligently.

- Read relevant source deeply, not every large file repeatedly.
- Maintain a repository inventory and reference it across PRs.
- Search exact symbols and call sites before opening unrelated files.
- Reuse existing tested abstractions.
- Avoid repetitive architecture debates.
- Avoid speculative dependencies.
- Avoid unnecessary subagents and full-suite reruns after every tiny edit.
- Run focused tests during development and appropriate comprehensive tests before PR completion.
- Do not generate enormous documentation containing duplicated analysis.
- Preserve exact commit and file references.
- Prefer one sound implementation over several alternative implementations left in the codebase.

Do not omit necessary analysis merely to reduce token usage. Optimize redundant work, not essential verification.

## 10. Continuous implementation checkpoint

Maintain one concise, authoritative checkpoint file, such as:

`docs/public-beta/EXECUTION-CHECKPOINT.md`

Record:

- Current baseline SHA.
- Master directive version.
- Approved decisions.
- Completed PRs and SHAs.
- Exact verified capabilities.
- Failed and skipped tests.
- Pending migrations.
- Known blockers.
- Unchanged security invariants.
- Current implementation package.
- Next concrete code action.
- Required owner approvals.
- Relevant deployment verification.
- Remaining work packages.

Update it after every completed package and before reaching a context or execution limit.

A new Codex session using the same model and effort must be able to resume from this checkpoint without reconstructing the entire project or making fresh contradictory decisions.

If execution must stop, leave the working tree in a recoverable state and provide an exact, self-contained continuation instruction.

Do not claim that work continues in the background once the session has ended.

## 11. Objective quality evidence

Use actual results rather than labels such as "MAANG quality", "world-class", "enterprise grade" or "100% complete" without verification.

For each change report:

- What was implemented.
- What users can actually do.
- Which behavior was independently exercised.
- Which existing behavior remains intact.
- Relevant test results.
- Security and privacy implications.
- Provider configuration requirements.
- Operational failure behavior.
- Remaining issues.
- Exact commit and deployment identifiers.

`IMPLEMENTED` is not the same as `VERIFIED_LIVE`.

A skipped or mocked integration test is not evidence of a live integration.

A successful public-page smoke test is not proof of authenticated product functionality.

A configured scanner is not automatically a healthy scanner.

A successful database migration is not proof that every application query or identity relationship is correct.

Do not fabricate perfect coverage or guarantee the absence of defects.

## 12. Public-beta completion standard

The implementation is ready for public beta only when the announced scope is supported by real evidence:

- Public Neon Auth registration and account recovery.
- Resend email delivery.
- Free traveller and agency access.
- Working complete role-appropriate workflows.
- Correct isolation and consent-based collaboration.
- Safe and recoverable document management.
- Properly functioning configured AI operations and reliable non-AI alternatives.
- Effective background processing.
- Accurate user-facing states.
- Usable admin operations and cost monitoring.
- Future monetization compatibility.
- Tested data export, retention and deletion.
- Appropriate security, backup and incident protections.
- Truthful legal and capability disclosures.
- Actual environment-specific release verification.

If these conditions are not met, do not present the system as completely ready.

Finish every authorized code-level requirement that can be finished. Distinguish unavailable external actions from engineering defects.

Do not hide a blocker through mock data, bypass logic, a disabled test, an optimistic readiness flag or misleading documentation.

## 13. Final execution instruction

**Execute the complete VisaStack Master Public Beta Implementation Directive using GPT-6.1 Sol Medium throughout.**

Internally decompose the task into coherent work packages. Complete authorized implementation tasks sequentially with appropriate parallelization only for genuinely independent work.

Do not require the owner to switch models, change reasoning effort, supervise each coding step, or repeatedly approve settled product decisions.

Maintain source-of-truth continuity across tasks.

Prioritize complete functionality, verified security, durable data, architecture preservation, user experience, operational simplicity, realistic costs and future extensibility.

Never trade away a necessary security or correctness guarantee to increase implementation speed.

Where execution limits prevent completion in one session, preserve the exact checkpoint and continuation procedure without misrepresenting unfinished work.

**The measure of success is a functioning, independently testable and durable VisaStack public beta - not the volume of code generated, the number of PRs merged, or the model's confidence in its own work.**

Begin with the current repository checkout and proceed with implementation.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
