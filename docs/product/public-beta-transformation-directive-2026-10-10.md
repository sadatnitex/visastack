# VISAStack  -  Public Beta Transformation & Free-to-Scale Implementation Mandate

> Owner-supplied directive recorded on 2026-10-10. The owner reports that signup and sign-in already work. This document records planned work; it does not claim the work or live verification is complete.

Instruction to Codex: Execute this directive against the existing VisaStack repository. This is an implementation assignment, not merely an architecture review or planning exercise.
Repository: "https://github.com/sadatnitex/visastack"
Reference baseline: "e16b70e233eabba2f91234f0dd4f8df3d754196d", 9 October 2026. Re-fetch "main" at execution time. The actual current head takes precedence over this historical reference.
Mission: Advance VisaStack from its existing controlled-pilot/Commercial V1 implementation into a secure, genuinely usable, publicly accessible, initially free platform, retaining the architectural and operational foundations required for a much larger commercial mobility ecosystem.
0. EXECUTIVE MANDATE
You are acting as VisaStack's principal engineer, architect, application-security lead, product engineer, QA lead and release engineer.
Your responsibility is to deliver the actual working system, preserve its existing strengths, eliminate unnecessary restrictions, complete missing integration paths, and verify its behavior.
Do not interpret this assignment as permission to redesign the product from scratch.
Do not respond with another large generic roadmap and stop.
Begin by inspecting the repository, then implement the required changes through coherent, dependency-ordered work packages.
0.1 Decisions that are already final
1. Neon Auth is VisaStack's authentication platform. WorkOS is no longer a runtime provider for this stage.
2. Resend is the email platform, including SMTP delivery for Neon Auth and application-generated transactional messages.
3. Neon PostgreSQL remains the canonical database, using the existing Drizzle persistence architecture.
4. The existing Next.js, TypeScript, pnpm/Turborepo, service, policy and adapter architecture is retained.
5. The product opens to public registration. Registration is not restricted to invitations or an arbitrary founding-user count.
6. Every applicable, genuinely operational feature is available without payment during public beta.
7. Future monetization is preserved from day one, but payment processing and subscriptions must not obstruct beta usage.
8. Use free provider allowances where legally and technically suitable, with measured upgrade triggers and affordable alternatives when necessary.
9. Security, privacy, safety, auditability and data durability are non-negotiable.
10. The target is a working real-world product, not a simulated or purely synthetic-data demo.
11. Preserve future extensibility without prematurely building unrelated future businesses or introducing speculative complexity.
12. The latest owner instructions supersede contradictory historical plans and comments, except for essential safety and preservation requirements.
Do not reopen these decisions merely because an older ADR, PRD, "CLAUDE.md", or implementation document recommends WorkOS, invitation-only registration, or blocking all beta features behind commercial certification.
0.2 Work authorization and boundaries
You are authorized to inspect, refactor, write code, add tests, update documentation, create branches and prepare implementation pull requests.
Execute code-level work autonomously. Do not ask for confirmation between routine engineering steps.
Code-only changes can follow the repository's normal tested PR/merge process when non-destructive and verified.
However, do not without explicit owner approval for the particular action:
- Apply production database migrations or destructive data changes.
- Delete or overwrite existing production records.
- Rotate or replace production identity, encryption or storage secrets.
- Switch the live production identity provider before verification.
- Open public registration on the production hostname.
- Permit real sensitive-document intake without verified safeguards.
- Activate payments, incur new recurring charges, or upgrade a paid provider plan.
- Disable production security, retention or audit protections.
- Publicly claim launch readiness, compliance certification or independent security approval.
Where such approval is required, complete everything else first and present one consolidated, precise owner-action list.
Never put credentials or real personal data in commits, logs, documents, examples or test fixtures.
1. PRODUCT VISION AND NON-NEGOTIABLE DOMAIN CONTRACT
1.1 What VisaStack fundamentally is
VisaStack is a traveller-owned mobility information, evidence and workflow platform.
Its foundation is not an individual visa application, a collection of uploaded PDFs, a chatbot, or an agency CRM.
The foundation is a durable, reusable record maintained under the person's control, with purpose-specific workflows built upon it.
The essential relationship is:
Identity → Person/Family → Canonical Facts → Versioned Evidence → Purpose-Specific Case → Authorized Collaboration → Reviewed Outcome → Reuse
Every major implementation decision must preserve this relationship.
1.2 Core market proposition
A traveller should be able to maintain information and documents once, understand what is currently known or missing, reuse appropriate records across applications, and collaborate with agencies or contributors without surrendering ownership or control.
An agency should be able to organize clients and cases, collect selected evidence, assign work, review requirements, communicate clearly and complete its workflow without collecting unrestricted copies of a traveller's entire personal record.
The platform's intelligence should improve clarity, reduce duplicate work, reveal inconsistencies and provide explainable support, never manufacture immigration eligibility or substitute an authoritative decision.
1.3 Positioning boundaries
VisaStack must never imply that it:
- Guarantees a visa or immigration outcome.
- Submits directly to an embassy unless a genuine submission integration exists.
- Guarantees document authenticity because OCR or AI recognized its contents.
- Calculates an authoritative approval probability.
- Possesses official requirements for a route without a reviewed, current source-backed requirement pack.
- Has completed a security audit or legal certification without evidence.
Use readiness to mean traceable workflow and evidence completeness within the limits of maintained requirements, not predicted approval.
1.4 Future expansion contract
The existing foundation must support future roles and modules such as:
- Additional mobility and visa purposes.
- Multiple agencies and service providers.
- Family and authorized contributors.
- Employers and sponsored mobility.
- Education-related travel and institutional stakeholders.
- More sophisticated issuer/evidence verification.
- Country-specific workflows and requirement packs.
- Additional approved AI processing.
- Commercial packages, integrations and enterprise capabilities.
Do not implement these future modules merely to satisfy this paragraph.
Instead, preserve canonical entity identities, composable purposes/cases, provenance, tenant boundaries, versioning, grants, policy decisions, provider interfaces and auditable events.
The current "Mission" remains the canonical case entity. Do not introduce a competing "Case" system just to change customer-facing terminology.
2. SOURCE OF TRUTH AND REPOSITORY RECONSTRUCTION
2.1 Mandatory preflight
Before changing source:
1. Fetch and record the current "main" SHA.
2. Check the working tree for existing uncommitted user or agent work.
3. Inspect open PRs, active branches, migrations, deploy configuration and exact-head CI checks.
4. Identify the current production and preview deployment SHAs where access is available.
5. Inspect existing environment variable names and scopes, never expose their values.
6. Establish whether the production database already contains real customer records.
7. Record which external environments can actually be inspected and which cannot.
Do not overwrite unrelated work. Do not assume an old PR is safe to merge.
2.2 Documents to reconcile
Read and cross-reference relevant portions of:
- "CLAUDE.md"
- "README.md"
- "docs/product/commercial-v1-prd-2026-09-16.md"
- "docs/product/build-spec-v1.1.md"
- "docs/roadmap/commercial-v1-implementation-directive.md"
- "docs/commercial-v1/architecture-decisions.md"
- "docs/commercial-v1/requirements-ledger.md"
- "docs/commercial-v1/known-issues.md"
- "docs/commercial-v1/supersession-map.md"
- "docs/commercial-v1/final-report.md"
- "docs/commercial-v1/release-gate.md"
- "docs/commercial-v1/neon-auth-migration-plan.md"
- "docs/commercial-v1/free-stack-launch-plan.md"
- "docs/operations/public-beta-sign-in.md"
- Applicable architecture, security, audit, UX, operations and recovery documentation.
The requirements ledger and known-issues file are large, append-oriented records. Index them and retrieve relevant entries precisely instead of filling context with unrelated historical text.
Do not assume documentation's latest completion claim is proof that the deployed implementation works.
2.3 Create a complete inventory
Inventory every tracked path in the repository, including application source, services, adapters, policy, database, migrations, tests, workflows and documentation.
For every relevant executable component establish:
- Purpose and ownership.
- Public or internal callers.
- Inputs and outputs.
- Authorization boundary.
- Database tables and transactions.
- External provider dependencies.
- Background jobs and follow-up events.
- Existing tests.
- Actual user-facing route/action.
- Runtime configuration requirements.
- Current implementation state.
- Known failure and recovery behavior.
Inspect relevant source bodies and call chains rather than relying on file names or exported functions.
Distinguish implementation, configuration, deployment and verification failures.
2.4 Feature classifications
Each product capability must have exactly one currently justified status:
- "VERIFIED_LIVE"
- "VERIFIED_STAGING"
- "IMPLEMENTED_UNVERIFIED"
- "PARTIALLY_CONNECTED"
- "NOT_IMPLEMENTED"
- "PROVIDER_UNCONFIGURED"
- "SAFETY_DEPENDENCY_UNSATISFIED"
- "INTENTIONALLY_DEFERRED"
These classifications are evidence states, not permission controls.
Do not automatically enable a feature merely because a service function exists.
Do not continue describing a fully verified feature as unavailable solely because an old historical gate remains in documentation.
2.5 Initial deliverables
Write concise, versioned internal records for:
- Exact-SHA source inventory.
- End-to-end feature matrix by user role.
- Data and permission dependency map.
- Current Neon/Resend migration findings.
- Operational and cost dependency map.
- Existing security invariants.
- Implementation PR sequence.
- Known unresolved external dependencies.
Store these under an appropriately named "docs/public-beta/" directory.
These documents guide implementation. They are not a substitute for implementation.
3. TARGET ARCHITECTURE
Preserve and strengthen the existing dependency direction:
Web/application layer → services → policy/core → adapters and persistence
The application must remain organized around canonical services rather than duplicating business rules inside Server Actions, UI components or jobs.
3.1 Invariants to preserve
- One canonical Neon PostgreSQL writable record system.
- Explicit account/person/organization separation.
- Immutable fact versions and evidence references.
- Non-destructive historical document versions.
- No silent AI mutation.
- Atomic transaction and audit behavior where the existing contract requires it.
- Default-deny object authorization.
- Explicit, purpose-limited and revocable sharing.
- Case-specific evidence selection.
- No agency access inherited merely from membership.
- No cross-organization record leakage.
- Independently enforceable consent purposes.
- Recoverable durable work.
- Exact-version snapshots and applicant acknowledgement.
- Privacy-preserving data export and deletion.
- Provider-agnostic storage, AI and relevant operational interfaces.
Preserve the stable canonical IDs, migrations, audit references, historical account relationships and contractual service semantics.
3.2 Do not create parallel foundations
Do not introduce:
- A second applicant database.
- A second case or wallet model.
- A separate free-user authentication database.
- A new generic access-control framework replacing the existing policy engine.
- A parallel notification system.
- A parallel analytics store without a demonstrated need.
- A second billing catalog.
- A generic microservices platform for hypothetical future modules.
Build on existing interfaces unless there is a demonstrable defect that cannot be repaired in place.
4. NEON AUTH-ONLY IDENTITY TRANSFORMATION
Priority: P0.
The October 9 implementation added Neon authentication but left part of the application coupled to WorkOS. Finish the migration correctly.
4.1 Known source targets
Examine and update, as necessary:
- "apps/web/src/lib/identity-selection.ts"
- "apps/web/src/lib/identity-provider.ts"
- "apps/web/src/lib/neon-auth.ts"
- "apps/web/src/lib/session.ts"
- "apps/web/src/lib/session-age.ts"
- "apps/web/src/lib/neon-recency.ts"
- "apps/web/src/lib/step-up.ts"
- "apps/web/src/lib/sign-out.ts"
- "apps/web/src/app/app/layout.tsx"
- "apps/web/src/app/layout.tsx"
- "apps/web/src/middleware.ts"
- "apps/web/src/app/pilot-access-denied/page.tsx"
- "apps/web/src/app/callback/route.ts"
- "apps/web/src/app/api/session-reauth/route.ts"
- "apps/web/src/app/api/auth/[...path]/route.ts"
- "apps/web/src/app/auth/"
- "packages/services/src/accounts-neon.ts"
- "apps/web/src/lib/env.ts"
- "apps/web/src/lib/providers.ts"
- Related tests, package dependencies, middleware and security-policy code.
The list identifies known integration points; inspect the full dependency graph for additional ones.
4.2 Required final behavior
Neon Auth is the only supported live authentication provider.
The application must not silently fall back to WorkOS if the Neon configuration is absent, mistyped or unhealthy.
Missing mandatory authentication configuration produces a clear operational failure, not another identity-provider selection.
Existing domain-level identity interfaces may remain where they contribute to future testability and portability.
Remove WorkOS execution paths, old callback behavior, unused provider dependencies and obsolete environment requirements after proving that doing so will not destroy account continuity or audit history.
Do not delete historical "workos_user_id" values or related audit snapshots simply because runtime authentication changes.
4.3 Known defects to repair
- The main signed-in layout calls WorkOS logout instead of "signOutCurrentUser".
- The root layout still calls WorkOS "withAuth" to decide whether to display Sign in or Workspace.
- The denied-access screen still reads WorkOS session state.
- The identity-provider selection defaults to WorkOS.
- Commercial readiness still requires WorkOS production attestation.
- Obsolete callback and reauthentication paths remain.
- Existing browser smoke tests require redirection to WorkOS.
- Authenticated staging E2E still depends on old provider-specific assumptions.
Fix the actual wiring and the associated tests.
Avoid creating a second session state that can disagree with Neon Auth.
4.4 Authentication journeys
Verify all of these:
1. New user signup.
2. Email confirmation.
3. Unconfirmed email refusal.
4. Duplicate signup handling.
5. Normal sign-in.
6. Incorrect password handling.
7. Recovery email request.
8. Expired/used reset token.
9. Password reset success.
10. Existing-session invalidation following password reset, according to verified provider capabilities.
11. Password reauthentication for sensitive operations.
12. Logout and subsequent protected-route denial.
13. Session expiration.
14. Session renewal.
15. Multiple sessions and appropriate revocation.
16. Mobile browser sign-in and recovery.
17. Network interruption and retry behavior.
18. Concurrent signup and identity-linking races.
19. Generic errors that prevent account enumeration.
20. Correct post-authentication return paths without open redirects.
Verify behavior with the actual selected Neon package and deployed provider, not only a mock.
4.5 Existing pilot-account continuity
The new "accounts.neon_user_id" migration must remain additive and historically compatible.
Important discovery: migration "0084_plain_speed_demon" was reported successfully applied in a later October 9 GitHub Actions run, but the migration used the application database credential.
Recheck the actual target environment and migration journal before proposing any further schema change. Do not reapply 0084 blindly.
Most importantly:
A verified matching email address is not automatically sufficient to transfer a pre-existing, sensitive VisaStack account between identity providers.
Implement an appropriate secure linking procedure.
For an existing account with valuable records, prefer an approved original-session linkage or a controlled recovery procedure with stronger assurance.
Record link events, notify the account holder and refuse conflicting bindings.
Prevent account enumeration and cross-account data transfer.
If safe autonomous linking is not possible for an existing account, use an explicit recoverable migration state, not a silent takeover.
4.6 Privileged authentication
Staff privileges must have stronger assurance than ordinary traveller access.
Determine whether the exact managed Neon Auth version supports an appropriate MFA mechanism.
Do not assume that Better Auth features are automatically available through managed Neon Auth.
Do not equate typing the same password again with a second authentication factor.
Implement and prove supported MFA or a properly reviewed equivalent privileged-access arrangement.
If genuine MFA is unavailable, retain ordinary public access while preventing unsafe privileged operations. Report the exact limitation and the smallest compatible solution.
Do not add another external identity provider to work around this.
4.7 SDK compatibility
The repository currently pins "@neondatabase/auth" to "0.5.0-beta" and uses Next.js 15.5.
Verify the actual package's peer compatibility, middleware behavior, cookie handling, refresh semantics and reported session-renewal issues against current official documentation and tested integration.
Do not force a Next.js major upgrade merely to quiet an advisory unless compatibility requires it.
Any required framework upgrade must have its own compatibility checks across Server Actions, headers, CSP, middleware and deployment.
5. NEON AUTH + RESEND EMAIL DELIVERY
Priority: P0.
5.1 One deliberate email architecture
Use:
- Neon Auth for authentication logic and verification/reset tokens.
- Resend SMTP for Neon Auth-generated messages.
- The existing Resend application adapter for VisaStack transactional notifications.
- Existing notification/outbox tables for application delivery tracking.
Do not implement a second password reset or verification token system in VisaStack.
Do not assume Neon itself is a standalone transactional email vendor.
5.2 Integration requirements
Verify:
- Sending-domain ownership and DNS authentication.
- Neon Auth custom SMTP configuration.
- Appropriate sender addresses.
- Production versus staging sending isolation.
- Correct allowed callback origins.
- Signed Resend delivery webhooks.
- Bounce, rejection and complaint handling.
- Replay-safe webhook processing.
- Delivery status persistence.
- Idempotent retries.
- Non-disclosure of personal document contents in email.
- Clear separation between essential service email and optional marketing.
- Protection against bot-generated email quota exhaustion.
All actual credentials must remain in provider dashboards and environment secrets.
5.3 Free-tier budget behavior
Maintain a shared consumption model for both Neon Auth SMTP messages and application email.
Resend's free-tier allowance was reported as 3,000 monthly and 100 daily transactional emails when this directive was prepared. Confirm the current account's exact allowance before relying on it.
Do not hardcode a permanent contractual assumption.
Use alerts and priority rules so repeated, low-value reminders cannot consume all capacity required for legitimate verification and password-recovery messages.
Do not suppress a security-critical message silently and label it delivered.
Implement explicit operational reporting when the allowance is exhausted.
5.4 Deliverability and usability acceptance
Test with real consenting synthetic inboxes:
- Verification delivery.
- Reset delivery.
- Agency invitation.
- Evidence request.
- Expiry reminder.
- Delivery failure and retry.
- Bounce handling.
- Revocation before a queued message is sent.
Record actual provider message IDs and outcomes without leaking recipient identities in ordinary operational logs.
6. PUBLIC REGISTRATION, FULL ACCESS AND ENTITLEMENT REDESIGN
Priority: P0.
This is a fundamental product decision.
6.1 Target offer
VisaStack Founding Access
- Price during the announced beta period: zero.
- No paid subscription required.
- No credit card required.
- No invite required for public signup.
- No arbitrary maximum number of admitted users.
- Every operational feature available to its applicable user role.
- No fabricated unlimited-resource promises.
- Resource safety and fair-use rules communicated transparently.
- Clear future-pricing and notice policy.
Founding Access is a commercial/entitlement concept, not an authorization role.
6.2 Separate four different concerns
The current platform has tightly related deployment modes, capability flags, commercial readiness, pilot access and plan limits.
Refactor carefully to distinguish:
A. Admission: Who may register and enter the platform.
B. Authorization: Which specific person, record, organization, case and action an authenticated actor may access.
C. Operational assurance: Whether the relevant real feature can currently operate safely.
D. Commercial entitlement: Whether the user's assigned offer includes the capability and its fair-use terms.
Billing status must not substitute for object authorization.
Commercial certification must not substitute for real operational health.
Registration must not be prevented merely because the product has not begun charging.
6.3 Existing code to inspect
- "apps/web/src/lib/public-beta.ts"
- "apps/web/src/lib/pilot-access.ts"
- "apps/web/src/lib/capabilities.ts"
- "apps/web/src/lib/commercial-readiness.ts"
- "apps/web/src/lib/deployment-mode.ts"
- "apps/web/src/lib/readiness.ts"
- "packages/services/src/pilot-access.ts"
- "packages/services/src/plans.ts"
- "packages/services/src/entitlement-enforcement.ts"
- "packages/services/src/quotas.ts"
- "packages/services/src/billing.ts"
- "packages/core" capability and mode definitions.
- Related UI, actions, migrations and tests.
6.4 Precise access rules
Registration should be publicly available when the Neon Auth service and mandatory registration protections are operational.
Private records still require explicit authorization.
Agencies must not gain traveller-wallet access merely from a membership, invitation, email match, or organization status.
A person may simultaneously be a traveller and an agency employee, with clear separation of contexts.
Do not allow self-assignment of platform-administrator or verified-agency status.
Ordinary agency workspace creation and safe internal organization work should not require a payment or arbitrary manual commercial approval.
Review agency verification semantics carefully: allow legitimate self-service use where safe, while restricting claims of verification and genuinely privileged, trust-dependent actions.
6.5 Real-data readiness must not equal paid commercial readiness
The existing registry provides "publicSignup", "realApplicantData", "payments" and "commercialClaims".
Today "realApplicantData" is tied to commercial readiness, including requirements unrelated to whether an individual operation is safe.
Correct this coupling.
Real-data capability should depend on the actual applicable protections being present and verified.
Commercial claims and charging should depend on separate business, legal and commercial decisions.
Avoid one giant global bypass switch that makes unsafe operations available.
Do not delete commercial release evidence. Preserve it as a separate higher-level certification and operating-readiness program.
If adding a distinct "public_beta" mode is the cleanest approach, do so through the existing canonical mode registry, with migrations/tests where appropriate.
Otherwise retain the mode structure and implement independently evaluated capabilities. Choose the smallest correct architecture, not the largest refactor.
6.6 Plans and subscriptions
Reuse existing "plans", "subscriptions", "billingAccounts", usage meters, invoices and downgrade processes.
Preserve "TRAVELLER_FREE_PLAN_KEY" and existing customer records.
Implement a default complimentary plan or entitlement assignment for new traveller and agency accounts.
Correct the current agency UX that can display "No plan assigned" and unclear entitlements even though the person is permitted to use the product.
Make the beta offer explicit.
Future paid plans must use the same canonical entities, without rewriting accounts or changing applicant IDs.
Do not trigger scheduled downgrades from Founding Access merely because there is no payment method.
6.7 Economic abuse versus subscription gates
Retain and appropriately configure:
- Maximum individual file size.
- Bounded upload batches.
- Concurrency safeguards.
- Authentication throttling.
- Automation and spam abuse protections.
- Storage reservation consistency.
- AI provider budget protections.
- Operational rate limiting.
- Provider outage failover.
- Tenant and role permissions.
Remove plan-based limitations that unnecessarily prevent founding users from using product capabilities.
Prefer transparent capacity queueing, measured upgrade triggers and fair-use management to arbitrary feature removal.
No unlimited AI, storage or processing guarantees unless actually financially supported.
When capacity is exhausted, existing records and safe core actions must remain accessible wherever operationally possible.
7. SAFE REAL-DOCUMENT PIPELINE
Priority: P0 before accepting real identity documents.
This is the most important trust boundary in the product.
7.1 Preserve the existing lifecycle
Upload authorization → quota reservation → private quarantine → exact-byte integrity verification → real malware inspection → bounded content processing → safe preview → human review → approved evidence → authorized sharing/download → retention/deletion.
The existing transactional, idempotent and versioning protections should remain intact.
7.2 Source modules
Inspect:
- "packages/services/src/uploads.ts"
- "packages/services/src/intake.ts"
- "packages/services/src/documents.ts"
- "packages/services/src/wallet.ts"
- "packages/services/src/storage.ts"
- "packages/services/src/document-access-token.ts"
- "packages/services/src/preview-rendering.ts"
- "packages/services/src/protected-fields.ts"
- "packages/adapters/src/clamav-scanner.ts"
- "packages/adapters/src/scanner.ts"
- "packages/adapters/src/preview-renderer.ts"
- "packages/adapters/src/vercel-blob.ts"
- "packages/adapters/src/key-management.ts"
- "apps/web/src/lib/storage.ts"
- "apps/web/src/lib/providers.ts"
- "apps/web/src/app/api/blob/[key]/route.ts"
- Applicant document routes and actions.
7.3 Real antivirus
The structural scanner is not equivalent to antivirus.
Use the existing ClamAV adapter with a correctly provisioned, isolated and network-protected scanner service.
Verify real reachability, signature freshness, version and bounded processing.
The scanner must never be exposed as an unauthenticated public TCP service.
If the scanner is unavailable, the affected object remains quarantined. It must not be previewed, downloaded, shared or transmitted to an AI provider.
Provide a durable, visible retry mechanism.
Do not silently treat a scanner timeout as a clean result.
7.4 Upload constraints
Preserve the reviewed requirements, including PDF, JPEG and PNG support, file-size limits, PDF page limits, image megapixel limits, and batch limits.
Verify actual implementation and consistency with the Commercial V1 PRD.
Protect against malformed files, decompression bombs, excessively complex documents, unsafe parsing, object replacement and upload reservation races.
Do not claim a scan succeeded unless the exact stored object version and hash were checked.
Use storage keys that cannot reveal user identity or filenames.
7.5 Preview, originals and redaction
The existing capability registry marks "originalDownload" and "redactedDownload" disabled because their complete user-facing paths have not been wired.
Complete them.
Preview, redacted download and original download must remain distinct permission actions.
Every operation must re-evaluate current authorization, grant status, purpose, resource version and required reauthentication.
Do not bypass the existing policy service.
Do not expose reusable upstream storage bearer links.
Use short-lived, bounded, authorized delivery references with proper content headers and no-store behavior.
Where original document downloads are allowed, ensure appropriate safe attachment handling rather than unsafe inline rendering.
Where redaction is supported, ensure the output truly excludes protected information rather than merely overlaying visible shapes.
Do not market sophisticated editable redaction if only fixed/redacted preview functionality exists.
7.6 Encryption and keys
Inspect and preserve protected-field encryption.
Replace unsafe dependence on one unrecoverable environment-held master key with an appropriately managed key solution that fits the budget and risk.
Use the existing "KeyManagementPort" boundary.
Evaluate a reputable managed KMS or an equally defensible reviewed arrangement.
Prioritize:
- Key ownership and access restrictions.
- Versioned key identification.
- Key rotation.
- Envelope encryption.
- Recovery/escrow.
- Separation of application and key-administration permissions.
- Safe handling of existing encrypted records.
- Reversible migration when changing key infrastructure.
Never make protected records unreadable during a key migration.
Never label a local secret as a managed KMS merely to satisfy a launch condition.
7.7 Independent recovery
Document files and database metadata must both be recoverable.
Create and verify an independent backup that is not merely another reference to the same provider object.
Maintain encryption and access controls on the backup.
Restore must reconcile:
- Database records.
- Document blobs.
- Object versions.
- Key material.
- Consent and grants.
- Audit history.
- Job/outbox state.
- Deletion and legal-hold obligations.
Use the existing reconciliation and resurrection tooling where appropriate.
Perform restore drills against isolated synthetic data.
Report measured RPO/RTO rather than asserting targets are achieved because they appear in documentation.
Do not clone actual customer information into an insecure staging environment.
8. FULL TRAVELLER EXPERIENCE
Priority: P0 functional completion.
A real first-time traveller must be able to finish the following journeys without developer assistance.
8.1 Entry and onboarding
- Register and confirm email.
- Enter the signed-in workspace.
- Understand the next meaningful action.
- Create the principal traveller record.
- Add authorized family/guardian relationships.
- Understand privacy and consent choices.
- Start building a reusable profile.
- See incomplete versus completed setup states.
Do not use a lengthy mandatory onboarding wizard when progressive setup will work.
A user should never have to understand VisaStack's underlying data model to accomplish a basic task.
8.2 Master Profile
- Create and update facts.
- Support repeating facts such as passports, addresses, employment and travel history.
- Preserve original source and version history.
- Review pending suggestions.
- Approve or reject changes.
- Resolve conflicting facts.
- Understand what is self-declared, document-supported, agency-reviewed or issuer-confirmed.
- Reuse appropriate information in a new case.
No destructive overwrite of previously confirmed history.
8.3 Evidence wallet
- Upload supported documents.
- See scan and processing status.
- View safe approved previews.
- Correct metadata.
- Approve or reject naming/classification.
- Add or correct issue/expiry information.
- Access historical versions.
- Replace expired or incorrect evidence.
- Understand case-specific usage.
- Download authorized originals/redacted outputs.
- Export owned data through the existing privacy mechanism.
Failed processing must give a specific recoverable next action.
8.4 Case lifecycle
- Start independent visa cases.
- Select destination, purpose and applicable context.
- Attach a reviewed requirement pack where available.
- Use a clear manual checklist where no maintained pack exists.
- Select reusable evidence.
- Add tasks, deadlines and appointments.
- Review completeness and missing items.
- Prepare an exact-version snapshot.
- Complete applicant truth acknowledgement.
- Revise or supersede a previous snapshot safely.
- Record submission and outcome where supported.
- Preserve the case's historical state.
Never make users unable to start a case solely because VisaStack has not published a pack for that route.
8.5 Notifications and privacy
- See in-app notifications.
- Receive applicable verified email messages.
- Manage personal sharing.
- Review access history.
- Revoke grants.
- Request data export.
- Request deletion.
- Understand retention and legal-hold exceptions.
Make security decisions understandable without using technical jargon.
9. FULL AGENCY EXPERIENCE
Priority: P0 functional completion.
Preserve the existing agency service architecture rather than creating a new CRM layer.
9.1 Organization setup
An eligible user should be able to create an organization workspace and start safe internal activities without a payment or founder invitation.
Provide accurate organization verification states.
Self-created organization does not mean platform-verified organization.
9.2 Operational journeys
Complete and test:
- Agency profile and settings.
- Team invitations.
- Membership and role assignment.
- Client invitations.
- Client acceptance and explicit consent.
- Scoped client case access.
- Evidence requests.
- Evidence receipt and review.
- Case assignment and reassignment.
- Due dates and task tracking.
- Shared versus private notes.
- Review decisions.
- Applicant truth confirmation.
- Submission tracking.
- Outcome and complaint records.
- Authorized exports.
- Revocation, staff removal and case closure.
Every cross-party operation must be tested from both sides.
9.3 Tenant isolation
Test at least:
- Traveller A versus Traveller B.
- Agency A versus Agency B.
- Agency staff with and without membership.
- An agency with a narrow grant versus the rest of a client's wallet.
- A withdrawn grant.
- An expired grant.
- A staff member removed during an active session.
- A client who changes agencies.
- A private note visible to one agency but not another.
Use the existing canonical authorization engine.
A page hiding a button is not evidence that the underlying Server Action or API denies unauthorized operations.
9.4 Commercial plan display
During Founding Access, agency users should see a clear complimentary plan and real usage information.
The platform must not show misleading payment warnings, missing-plan errors or inactive-subscription banners that obstruct the free beta.
Retain the capability for later paid plans.
10. REQUIREMENT PACKS, VISA INTELLIGENCE AND TRUST
Priority: P1, necessary for a useful and truthful public release.
The platform must remain useful without broad preloaded visa information.
10.1 Requirement-pack governance
Preserve:
- Source citations.
- Official-source priority.
- Effective and last-reviewed dates.
- Pack versioning.
- Applicability.
- Publication controls.
- Staleness handling.
- Reviewer identity.
- Rule provenance.
- Conflict handling.
- Immutable case-to-pack references.
Never fabricate governmental requirements.
Never silently replace an earlier mission's governing pack version.
10.2 Minimum usable coverage
Provide a small, genuinely reviewed selection of relevant initial route packs if qualified source verification and content ownership are available.
Prioritize accuracy and maintained scope over the number of countries.
Where no pack is published, provide a fully usable manual-route workspace that visibly states that no authoritative checklist has been verified for that route.
Do not invent route packs to make the catalog look populated.
10.3 Readiness semantics
Readiness must explain:
- Which reviewed requirement applies.
- What evidence was selected.
- What check was performed.
- Which requirement remains incomplete.
- What requires human review.
- What cannot be determined.
- Why a conclusion was reached.
- Which pack version produced the result.
A green completeness indication must never be interpreted as a prediction of visa approval.
11. AI DOCUMENT INTELLIGENCE AND PROVIDER CONTROL
Priority: P1, with existing safe manual functionality preserved throughout.
11.1 Preserve the current AI design
The repository already contains significant work for:
- Deterministic extraction.
- MRZ reading.
- Text classification.
- Versioned AI-provider configurations.
- OpenAI, Gemini and Anthropic adapters.
- OCR.
- Suggestions and human approval.
- Budgets and request accounting.
- Administrative activation and rollback.
- Evaluation harnesses.
Do not replace this with a generic LLM prompt or a second AI subsystem.
11.2 Required output behavior
AI proposes. A person approves.
Preserve provenance, source linkage, immutable record versions, confidence/uncertainty and review requirements.
Do not automatically overwrite applicant records from extracted text.
Do not convert a model's plausible answer into an official rule.
11.3 Free-first execution
Use deterministic and local processing wherever reliable.
Maintain provider-based AI selection through the existing configuration architecture.
A free-tier model may be used for synthetic, nonsensitive or contractually permitted inputs.
Do not send real passport scans, identity documents or similarly sensitive information to a free AI API when its terms permit using those inputs to improve the provider's products or otherwise conflict with VisaStack's privacy obligations.
For sensitive documents, require an appropriate approved processing arrangement, consent and terms.
A small paid amount for authorized sensitive processing is preferable to violating privacy merely to keep an API bill at zero.
11.4 Cost and reliability
Preserve and extend:
- Per-task token or usage estimation.
- Actual usage reconciliation.
- Provider-specific pricing metadata.
- Task-level reservations.
- Monthly platform budgets.
- Retry bounds.
- Timeouts.
- Idempotency.
- Provider activation checks.
- Failure classifications.
- Manual fallback.
- User-visible queued and failed states.
Do not claim an AI feature is operational unless at least one compatible provider is actually configured and exercised live.
Do not make AI mandatory to complete standard cases.
11.5 Quality validation
Test document extraction against a representative, synthetic and licensed document corpus.
Include poor images, multilingual content, missing fields, contradictory dates, expired documents and malformed documents.
Measure factual extraction and groundedness separately from schema validity.
AI-generated outputs must always distinguish actual evidence from inference.
12. NOTIFICATIONS, DURABLE JOBS AND TIME
Priority: P1.
The application currently combines immediate "after()"-triggered work with durable database jobs and daily recovery cron.
Keep the strong parts.
12.1 Preserve the durable outbox model
Do not rebuild the job system merely because it currently uses Neon/Postgres.
Retain:
- Durable queue records.
- Idempotency keys.
- Retry schedules.
- Leases.
- Dead-letter or terminal failure states.
- Operational reporting.
- Recovery after an interrupted invocation.
12.2 Correct timing and recovery gaps
Immediate job execution is already attempted after some user actions. Verify its success and failure behavior.
Daily cron is a recovery mechanism for some jobs, but it is not sufficient for timely task/expiry sweeps or retries whose service objectives require greater frequency.
Choose the cheapest reliable, compliant worker/scheduler arrangement.
It may be Vercel Pro scheduling, an appropriately secured external scheduler or a compatible worker deployment. Select from verified infrastructure constraints and actual cost.
Do not create an always-on service without proving it is needed.
12.3 Functional guarantees
- An upload produces a durable processing job.
- A crashed immediate worker does not lose the task.
- Due retries are eventually picked up.
- A delivered notification is not duplicated unnecessarily.
- A revoked invitation or grant is rechecked before sending a related message.
- Scheduled events use UTC internally and appropriate local-date rendering.
- Backlogs, oldest pending work and repeated failures are visible to the operator.
- Jobs cannot be triggered publicly without authorization.
- Time-sensitive user-facing claims match the actual supported scheduling precision.
13. FREE-TO-SCALE INFRASTRUCTURE
Priority: P1, with mandatory cost/safety preflight before public activation.
13.1 Provider register
Maintain a factual provider register covering:
Layer| Preferred stage-one arrangement| Upgrade strategy
Hosting| Existing Vercel deployment, contractually permitted plan| Increase capacity or move behind existing application boundaries if justified
Database| Neon PostgreSQL| Upgrade compute/storage without replacing canonical entities
Authentication| Neon Auth| Upgrade allowance or capacity within the same selected provider
Email| Resend| Upgrade transactional allowance without rewriting notification services
Object storage| Existing private Vercel Blob implementation| Expand or migrate through the existing storage interface if justified
Independent backup| A suitably secure second storage boundary| Increase backup storage and retention
Scanner| ClamAV worker/service| Increase scanning throughput
Encryption| Properly governed key service| Scale key operations and establish rotation
AI| Existing provider gateway| Approved provider/model/budget configuration
Jobs| Postgres-backed durable jobs and reliable triggers| Increase worker throughput/scheduler frequency
Observability| Existing logs, operational signals and external monitoring| Upgrade retention, alerting and telemetry
Verify each provider's terms and actual account entitlements as of implementation.
Do not confuse a free marketing plan with the user's actual available quota.
13.2 Upgradeability requirements
A provider upgrade must not require changing traveller IDs, document versions, agency memberships, consent grants, case histories, plan IDs or audit events.
Document which upgrades are configuration-only and which require migrations.
Where migration is necessary, specify reconciliation, dual-operation or cutover, verification and rollback.
Do not advertise seamless switching unless it has been demonstrated.
13.3 Hosting compliance
Check Vercel's current Hobby non-commercial restrictions against the intended public, venture-oriented launch.
Do not assume zero revenue makes every commercial-intent workload eligible.
If Pro is required, identify the actual minimal owner action and budget impact.
Do not migrate the entire application to unfamiliar infrastructure to save a small fee while increasing security, maintenance or operational risk.
13.4 Headroom and protective behavior
Measure or estimate:
- Database storage.
- Database compute.
- Connection pressure.
- File storage.
- Object operations.
- Function invocations.
- Worker duration.
- Emails sent/remaining.
- AI usage and spending.
- Backup age/storage.
- Scan queue capacity.
Alert before exhaustion, with configurable warning and critical thresholds.
Where data from provider APIs is unavailable, show "not_measured", not an invented number.
Never treat a configured environment variable as proof that the provider is healthy.
14. FOUNDER OPERATIONS & ANALYTICS
Priority: P1.
This must become a practical control room for the founder, not another decorative metrics screen.
Reuse:
- "packages/services/src/product-events.ts"
- "packages/services/src/operational-signals.ts"
- "apps/web/src/app/app/admin/page.tsx"
- Existing audit, plan, usage and job services.
14.1 Business intelligence
Present real, appropriately privacy-preserving data for:
- Registered accounts.
- Verified and activated users.
- Onboarding completion.
- Traveller versus agency accounts.
- Active travellers and organizations.
- Profiles created.
- Documents uploaded.
- Documents successfully scanned.
- Documents pending review or failed.
- Cases started and progressed.
- Evidence requests issued and resolved.
- Invitations sent and accepted.
- Collaboration usage.
- Return visits and repeat cases.
- Funnel abandonment.
- Successful exports.
- Outcomes, where recorded.
- Product usage by capability.
Use accurate denominators and time windows.
Do not fabricate baseline revenue or conversion metrics.
14.2 Unit economics
Calculate where evidence exists:
- Storage cost per active user.
- Average document-processing cost.
- AI usage per task.
- Email cost per active user.
- Infrastructure costs by provider.
- Cost per completed workflow.
- Estimated costs for additional user cohorts.
- Projected upgrade headroom.
Clearly separate verified provider charges, estimates, configured prices and unavailable data.
14.3 Technical operations
Provide prioritized views for:
- Degraded providers.
- Authentication errors.
- Email delivery problems.
- Scanner availability.
- Queue backlog and stuck jobs.
- Suspicious rate-limit activity.
- Database schema drift.
- Backup status.
- Restore verification status.
- Key-service health.
- Error trends.
- Security events.
- Audit-chain verification.
- Deployment SHA and release status.
The dashboard must never leak personal document contents through telemetry.
14.4 Actions, not only reports
Where appropriate and authorized, provide safe operator actions such as:
- Retry eligible failed work.
- Disable an unhealthy AI configuration.
- Examine failed delivery metadata.
- View recent deployment checks.
- Investigate an audit exception.
- Export aggregated usage reports.
- Inspect verified resource headroom.
Each administrative action requires the appropriate privilege, logging and additional assurance where sensitive.
Avoid implementing broad super-admin bypasses.
15. SECURITY, PRIVACY AND PRODUCT DURABILITY
Priority: P0.
15.1 Mandatory controls
Preserve or complete:
- Verified identity.
- Secure sessions and revocation.
- Appropriate privileged-user MFA.
- Action-bound reauthentication.
- Default-deny tenant and object authorization.
- Explicit consent and sharing limits.
- Malware quarantine.
- Protected-field encryption.
- Secure original-file delivery.
- Safe previews.
- Audit-chain integrity.
- Backup and recovery.
- Retention and deletion.
- Legal holds.
- Rate limiting and bot protection.
- Dependency and secret scanning.
- Incident response.
- Production/staging isolation.
- Privacy-preserving telemetry.
- Secure provider webhooks.
- Safe CORS/CSP/redirect behavior.
- Secure configuration and secret management.
Do not remove an existing security control merely because it obstructs a user journey.
Instead implement the missing mechanism so the user can complete that journey safely.
15.2 Public-beta legal and privacy surface
Build a functioning:
- Terms-of-use page.
- Privacy notice.
- Data processing and provider disclosures appropriate to the actual system.
- Clear signup acknowledgement mechanism where required.
- Versioned notice acceptance records.
- Contact/support channel.
- Data export/delete explanation.
- Consent choices separated by purpose.
- Optional marketing consent that is never bundled with essential processing.
Engineering may draft the surfaces, but must not claim legal review or compliance certification.
Flag jurisdiction-specific legal questions and cross-border personal data processing for qualified review.
Do not harvest optional consent unnecessarily.
15.3 Real-data boundary
Real identity data should only be accepted once the applicable protection requirements are genuinely satisfied.
Do not make users pass a payment or commercial-certification gate for an otherwise safe feature.
Do not permit real passport/identity uploads by simply changing "DEPLOYMENT_MODE", "PUBLIC_BETA_OPEN", or an attestation flag.
Use actual security readiness, enforced at the operation.
If real sensitive intake is not yet safe, clearly identify the specific blocker and finish its implementation. Do not mislabel the limited state as the completed public beta.
15.4 Recovery and incidents
Maintain an actionable response for:
- Unauthorized access.
- Exposed documents.
- Account takeover.
- Lost encryption material.
- Storage outage.
- Database corruption.
- Scanner outage.
- Email outage.
- AI-provider issue.
- Worker failure.
- Broken deployment.
Keep the procedures current with Neon Auth + Resend.
Incident role names are not evidence that a responsible, reachable human exists.
16. USER EXPERIENCE AND PRODUCT COMMUNICATION
Priority: P1.
Preserve the recent substantial UI/UX work unless specific research or tests justify a change.
Do not trigger another broad visual redesign merely to make the release look new.
16.1 Experience principles
- Clear next action.
- Progressive disclosure.
- Mobile-first interaction.
- Low-bandwidth resilience.
- Accessible keyboard navigation.
- Screen-reader clarity.
- Consistent empty, loading, success and error states.
- No repeated unnecessary personal-data entry.
- No misleading success confirmation.
- No hidden failure.
- Readable plain-English content.
- Accurate permissions and processing status.
- Stable navigation between traveller and agency contexts.
Maintain the existing i18n architecture. Do not launch an unrelated full Bangla translation project unless separately authorized, but do not break existing localized surfaces.
16.2 Update obsolete messaging
Review:
- Public homepage.
- Signup and signin.
- Pilot banner.
- Admin access.
- Agency onboarding.
- Status page.
- Privacy notices.
- Plan/usage page.
- Transactional emails.
- README and release documentation.
Remove inaccurate statements such as "invite-only" when public registration is active.
Do not imply that real documents are supported before they genuinely are.
Do not claim every future feature already exists.
16.3 Founding offer communication
The public should understand:
- What VisaStack does.
- Who can use it.
- What is currently available.
- That access is presently complimentary.
- What personal information is processed.
- Who controls sharing.
- Whether AI is used.
- What is not official or guaranteed.
- How future pricing may be introduced.
- How they retain or export their records.
Avoid generic AI-generated marketing language and exaggerated "world's first" claims.
17. TESTING AND ACCEPTANCE
Do not report success based only on a successful build or a passed public-page smoke test.
17.1 Repository verification
Use the existing actual package scripts and installed tools.
Run, as applicable:
- Dependency installation with locked versions.
- Lint.
- Strict TypeScript checks.
- Build.
- Unit tests.
- Service integration tests.
- Database migration validation.
- Permission tests.
- AI evaluation tests.
- Browser tests.
- Security checks.
- Production dependency audit.
- Relevant load tests.
Inspect test output. Failures and skipped tests must be reported separately.
Do not remove, skip or weaken assertions to force a green check.
17.2 Authentication test replacement
Replace obsolete WorkOS-specific no-secret tests and the old authenticated-workspace assumptions with Neon Auth scenarios.
A "WorkOS Staging E2E" workflow marked overall successful while its actual authenticated test job is skipped is not successful Neon E2E evidence.
Ensure CI reports actual exercised authenticated journeys separately from framework setup or workflow metadata.
Run tests against the intended environment, not an unrelated successful deployment of the same source.
17.3 Real end-to-end fixture
Use isolated, synthetic accounts representing:
- Traveller A.
- Traveller B.
- Agency A owner.
- Agency A case manager.
- Agency B owner.
- Authorized family/contributor role.
- Platform administrator.
- Unauthorized visitor.
Use fixtures for documents, consent, grants, agency permissions, expiry, AI suggestions, cases and notifications.
Test both positive and adversarial paths.
17.4 Acceptance journeys
J01: New traveller registers, confirms email and signs in.
J02: Existing account is securely linked or recovered without unauthorized record transfer.
J03: Logout, reset, stale session and recovery behave correctly.
J04: Traveller creates reusable profile with version history.
J05: Traveller uploads and processes a safe document.
J06: Unsafe document stays quarantined.
J07: Owner previews and downloads only through authorized paths.
J08: Agency creates a usable workspace without payment.
J09: Agency invites a client and receives explicitly accepted access.
J10: Agency requests evidence and client responds.
J11: Reviewer resolves evidence and task status.
J12: Traveller creates a case using maintained or manual requirements.
J13: Case readiness correctly identifies supported/missing/unknown items.
J14: Applicant acknowledges the exact versioned record prepared.
J15: Grant pause/revocation immediately prevents subsequent access.
J16: Agency A cannot see Agency B's private information or unrelated wallet evidence.
J17: Notifications are actually delivered, retried or visibly failed.
J18: AI processing follows consent, privacy and human approval requirements.
J19: Customer data export/deletion works with retention/legal-hold rules.
J20: Backup and restore reconstruct a consistent record and file set.
J21: Staff privileges are protected by verified appropriate assurance.
J22: Free user can use every operationally applicable feature without payment.
J23: App remains usable during a nonessential AI outage.
J24: Cost and capacity alerts reflect actual provider measurements where available.
J25: A future plan can be assigned without replacing account or domain records.
17.5 Acceptance standard
Every journey must have:
- Source revision tested.
- Environment tested.
- Named test fixture.
- Preconditions.
- Expected results.
- Actual results.
- Failure/negative assertions.
- Supporting logs or artifacts.
- PASS / FAIL / BLOCKED / NOT_EXECUTED state.
No declaration of 100% correctness merely because every written test passes.
17.6 Security and performance standards
Use the existing PRD's measurable release requirements wherever defined.
Do not invent benchmark success.
Verify responsive operation on common mobile viewport sizes and slower networks.
Test concurrency for account creation, quota reservation, grants, document versions, jobs and billing records.
Prove that sensitive operations fail safely under dependency failures and race conditions.
18. IMPLEMENTATION WORK PACKAGES
These are ordered by dependency. Codex should execute them sequentially where necessary and combine only when doing so reduces risk without sacrificing reviewability.
PR-00  -  Baseline reconciliation and proof
Objective: Establish exact source, deployment and test truth.
Tasks:
- Freeze current SHA for analysis.
- Review core documentation.
- Map source dependencies.
- Identify real versus historical blockers.
- Confirm migration 0084 status for relevant environments.
- Map open PR conflicts.
- Record deployment and provider inspection limitations.
- Identify data-preservation risks.
- Produce executable acceptance matrix.
- Preserve clean rollback references.
Exit: A credible current implementation baseline exists.
PR-01  -  Neon-only authentication completion
Objective: Remove active WorkOS dependence without harming existing user records.
Tasks:
- Repair logout.
- Repair root authenticated navigation.
- Correct denied-access screen.
- Simplify identity selection.
- Correct middleware/auth routes.
- Reconcile callback and CSP behavior.
- Verify session duration and reauthentication.
- Harden legacy account linking.
- Update privileged-role identity handling.
- Remove obsolete runtime dependencies when safe.
- Replace old identity tests.
- Update identity runbooks.
Exit: Verified Neon Auth flows; no WorkOS runtime dependence; preserved account continuity.
PR-02  -  Resend and public admission
Objective: Make authentic public signup and email workflows usable.
Tasks:
- Validate Neon SMTP / Resend architecture.
- Improve sending and recovery throttles.
- Verify callbacks and domain handling.
- Build public signup terms and disclosure UX.
- Repair pilot admission logic.
- Add anti-bot controls.
- Add actual delivery tests.
- Correct beta messaging.
- Keep free public access independent of billing.
Exit: New users register and access permitted workspaces without invitation or payment.
PR-03  -  Founding Access and capability separation
Objective: Establish free full-feature access without security bypasses.
Tasks:
- Separate admission, authorization, safety and entitlements.
- Assign complimentary traveller/agency access.
- Keep future billing records and logic intact.
- Remove unnecessary commercial gate coupling.
- Fix no-plan UI.
- Add fair-use and operator thresholds.
- Prove ordinary access is not contingent on payment.
- Prove privilege/tenant rules still deny unauthorized actors.
Exit: All safe, implemented role-appropriate capabilities available on the free offer.
PR-04  -  Real-data document safety and recovery
Objective: Make real evidence processing operationally defensible.
Tasks:
- Provision/test real scanning adapter.
- Verify private object storage.
- Finish original/redacted downloads.
- Implement appropriate key management.
- Protect legacy encrypted data.
- Add independent file backup.
- Complete restore/reconciliation tests.
- Verify retention, deletion and access revocation.
- Add actual status and recovery UX.
Exit: Sensitive evidence can be accepted only with the necessary verified protections.
PR-05  -  Traveller and agency end-to-end completion
Objective: Remove remaining broken operational journeys.
Tasks:
- Repair profile and document integration paths.
- Complete case lifecycle.
- Validate family/contributor relationships.
- Complete agency onboarding and invitations.
- Verify evidence request and review workflows.
- Test case snapshots and acknowledgements.
- Verify narrowly scoped sharing.
- Verify exports and closures.
- Correct misleading or missing interface states.
Exit: End-to-end workflows for independent travellers and agencies pass in a production-like environment.
PR-06  -  Reliable notification and processing infrastructure
Objective: Ensure activity-driven and scheduled operations execute reliably.
Tasks:
- Verify immediate durable job triggering.
- Fix retry/lease/recovery gaps.
- Introduce appropriate scheduler frequency.
- Protect job endpoints.
- Reconcile email delivery.
- Add backlog detection.
- Verify cron cost/plan compatibility.
- Test outages and retries.
Exit: Operational tasks complete within proven timing bounds, with recoverable failures.
PR-07  -  Requirement quality and AI operationalization
Objective: Deliver truthful, useful case intelligence.
Tasks:
- Preserve manual-route functionality.
- Review requirement-pack publication behavior.
- Publish only source-verified content.
- Test applicability/readiness.
- Verify AI models and privacy.
- Preserve manual human review.
- Validate actual provider integrations.
- Add cost accounting and fallback UX.
Exit: Real configured intelligence works where approved; missing coverage is accurately disclosed.
PR-08  -  Founder control room and commercial readiness
Objective: Make the platform observable, affordable and monetization-ready.
Tasks:
- Extend existing admin analytics.
- Add operational resource headroom.
- Add email/storage/AI cost visibility.
- Add activation and retention measures.
- Add backup and key-health indicators.
- Preserve future paid plan definitions.
- Verify founding users cannot be accidentally charged.
- Create provider-upgrade procedures.
Exit: The founder can understand growth, usage, cost, risk and upgrade decisions.
PR-09  -  Public Beta Release Candidate
Objective: Produce a genuinely validated public-beta release.
Tasks:
- Execute all applicable acceptance journeys.
- Run security and dependency scans.
- Run production-like performance checks.
- Verify isolated staging deployment.
- Verify real selected external integrations.
- Check legal/privacy disclosures.
- Verify cross-tenant authorization.
- Reconcile all documented blockers.
- Validate backup and recovery.
- Prepare rollback.
- Prepare consolidated owner-action checklist.
- Confirm correct public-domain configuration.
- Record exact candidate SHA and test artifacts.
Exit: Clearly classified "BETA_READY", "BETA_BLOCKED", or "LIMITED_BETA_ONLY", supported by evidence.
Do not activate real sensitive-data intake or public production registration merely because PR-09 is coded.
19. DOCUMENTATION AND GOVERNANCE
Create and maintain the following under "docs/public-beta/":
1. "PRODUCT-CONTRACT.md"
2. "SOURCE-AND-DEPENDENCY-MAP.md"
3. "FEATURE-AVAILABILITY.md"
4. "NEON-RESEND-IDENTITY.md"
5. "ACCESS-AND-ENTITLEMENTS.md"
6. "SECURITY-INVARIANTS.md"
7. "PROVIDER-COST-REGISTER.md"
8. "IMPLEMENTATION-TRACEABILITY.md"
9. "TEST-AND-ACCEPTANCE-EVIDENCE.md"
10. "OPERATIONS-AND-UPGRADES.md"
11. "RELEASE-AND-ROLLBACK.md"
12. "OWNER-ACTIONS.md"
13. "FINAL-PUBLIC-BETA-REPORT.md"
Do not produce hundreds of duplicative documents.
Cross-link existing authoritative PRDs and implementation records instead of copying them.
Mark old WorkOS-specific and invite-only statements as superseded when appropriate.
Do not rewrite historical evidence to falsely imply past work used Neon Auth.
Use append-only project history where the repository requires it.
19.1 Avoid documentation drift
For every feature implementation or correction, synchronize:
- Actual code.
- Tests.
- Relevant requirements ledger entries.
- Known issues.
- Provider configuration docs.
- User-facing capability statements.
- Current release evidence.
If a feature is implemented but not live-tested, say so.
20. CODING, REVIEW AND COST DISCIPLINE
20.1 Technical standards
- Follow the existing TypeScript strictness and repo formatting rules.
- Reuse current domain types and service return contracts.
- Use parameterized database operations.
- Favor additive, reversible schema migrations.
- Keep Server Actions small.
- Validate server-side permissions independently of UI.
- Do not duplicate business logic.
- Do not silently swallow security-relevant failures.
- Keep external calls bounded and observable.
- Maintain idempotency and concurrency controls.
- Do not embed provider API keys in source.
- Preserve accessible error recovery.
- Keep dependency versions deliberate and tested.
20.2 Agent efficiency
Implement in narrow, coherent work packages.
Before each PR:
1. Inspect the exact affected call paths.
2. State the intended invariant and failure cases.
3. Change the minimum correct code.
4. Add or repair tests.
5. Verify locally.
6. Review the diff for unintended changes.
7. Run required CI.
8. Record exact outcomes.
9. Merge through the authorized repository process.
10. Update the project status.
Avoid multiple exploratory rewrites of the same subsystem.
Avoid spawning redundant subagents or repeatedly running entire test suites when a targeted test is sufficient during development.
Before merging, perform the full required verification for that PR.
Use the existing GitHub/CI/Vercel mechanisms rather than introducing a second deployment pipeline.
20.3 Change safety
The current "main" branch has been observed without branch protection.
Recommend and configure branch-protection rules if permitted, but do not assume an unprotected main branch is safe to push to directly.
Prefer reviewed pull requests, required CI and exact-head verification.
Preserve rollback capability.
Do not mutate production just to make a test pass.
If the environment cannot access a provider, implement the code and synthetic integration tests, but clearly classify live verification as blocked.
21. FOUNDER ACTIONS AND EXTERNAL DEPENDENCIES
The owner is not expected to manually edit source files or change models halfway through a work package.
Engineering should complete everything feasible with the available repository and connected services.
For actions that genuinely require the owner, present one compact table containing:
- Provider or dashboard.
- Exact setting or approval.
- Why it is needed.
- Whether it creates a cost.
- Whether it is reversible.
- What engineering will verify afterward.
- What feature remains affected until completion.
Examples may include:
- Verified Resend sending domain.
- Neon Auth SMTP/allowed origins.
- Environment secrets.
- Privileged MFA configuration.
- Separate staging environment.
- Secure scanner endpoint.
- Managed key service.
- Independent backup storage.
- Hosting-plan eligibility.
- Legal approval.
- Named incident/security responsibilities.
- Production migration approval.
- Final production beta activation.
Never ask the owner for credentials in chat.
Never mark externally controlled work completed without observing its result.
22. RELEASE DEFINITION AND DECISION MATRIX
The release must distinguish access availability from sensitive-data readiness and commercial readiness.
22.1 Public access readiness
A public user can register, authenticate, access a free workspace and perform all applicable safe operations without subscription or invitation restrictions.
22.2 Real-data readiness
The platform can securely accept, process, retrieve, share, back up and delete sensitive information with proved operational safeguards.
22.3 Functional completeness
Actual travellers and agencies complete meaningful workflows through the real user interface.
22.4 Operational readiness
The platform has reliable background jobs, recovery, alerting, capacity awareness and incident handling.
22.5 Commercial readiness
Billing, contracts, legal review, pricing and commercial claims satisfy their separate future requirements.
Public beta does not require payment collection or full commercial certification. It does require truthful representations, appropriate privacy controls and safeguards for every real action made available.
22.6 Release outcomes
Use one of these evidence-based verdicts:
BETA_READY: Public access, functional journeys, real-data safeguards and necessary operational protections are proved for the announced beta scope.
LIMITED_BETA_ONLY: Some useful public functionality is safe and verified, but specific sensitive or provider-dependent operations remain unavailable. The public product must accurately describe those limitations. Never call it complete unrestricted beta.
BETA_BLOCKED: Foundational identity, security, privacy, durability or major functional failures make opening the proposed experience inappropriate.
No fabricated percentage-complete score.
23. NON-REGRESSION CONTRACT FOR FUTURE SCALE
After implementation, prove that the following actions do not require replacing canonical customer records:
- Add a second country requirement pack.
- Add another agency.
- Add multiple family members.
- Open a second concurrent case.
- Replace an expired passport.
- Revoke and later recreate a grant.
- Change the AI model.
- Upgrade Neon capacity.
- Upgrade Resend capacity.
- Increase background processing throughput.
- Increase object-storage capacity.
- Add a future payment provider.
- Offer a paid plan to a current free account.
- Introduce a new authorized institutional role.
- Add further reviewed country-specific data.
- Migrate storage behind the existing interface.
Do not claim these changes are zero-effort. Prove the data model and interfaces do not inherently require destructive redesign.
24. REQUIRED EXECUTION BEHAVIOR AND FINAL REPORT
Start implementation now.
Do not conclude the first session with only a plan if code work is feasible.
Proceed through the sequence in Section 18, respecting verified dependencies and production-action restrictions.
If interrupted or constrained by context/usage, persist a precise, commit-referenced continuation record in the repository so another Codex session can resume without losing the approved architecture or repeating completed work.
After each completed PR, report briefly:
Field| Required report
PR and commit| Exact URL and SHA
Product change| What users can now do
Preserved invariants| What was verified not to break
Tests| Passed, failed, skipped, blocked
Live status| Actually deployed and verified or not
External dependency| Only genuine owner/provider actions
Next task| Next implementation package
At completion, deliver:
1. Final production-bound commit SHA.
2. Implemented feature matrix.
3. Neon Auth + Resend live-verification results.
4. Traveller and agency end-to-end acceptance results.
5. Security/permission test evidence.
6. Real document and recovery verification.
7. Infrastructure cost and upgrade register.
8. Updated founder control room.
9. Remaining risks and their owners.
10. One consolidated founder-action list.
11. Public-beta launch checklist.
12. Rollback instructions.
13. Honest release verdict.
Final product acceptance statement
VisaStack must reach the point where:
A new traveller can independently join the platform, maintain a reusable personal mobility record, manage documents and cases, collaborate with an authorized agency, receive notifications, understand the applicable requirements, control access and export their information. An agency can operate meaningful case workflows on the same platform. Neither needs to pay during Founding Access. Sensitive information remains protected and recoverable. The founder can measure product adoption, technical health and costs. Future growth and monetization build on the existing architecture without replacing its canonical foundation.
That is the target.
Implement it with the smallest correct set of changes, complete operational evidence, and no deviation from the existing domain architecture or the decisions in this directive.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance. Production uses private R2 storage; database-only encrypted archive recovery is verified, while complete document/key/lifecycle recovery remains open.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
