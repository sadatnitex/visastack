# Execution checkpoint

Updated 2026-10-10. Frozen baseline: 698442a4124fce7f966aca2bee38b9f0e16bbd98. Branch: public-beta/baseline-and-neon-session-wiring.

Authority: [implementation contract](PRODUCT-CONTRACT.md), owner directive and execution protocol. Neon Auth + Resend decisions are settled. No production-sensitive change is authorized by this checkpoint.

Current package: PR-00 recorded locally; PR-01 started with a bounded session-shell wiring correction. No remote PR, merge, deployment or final beta verdict claimed.

Implemented: root navigation uses selected identity; workspace logout uses provider-aware sign-out; denial page reads selected identity without provisioning; sanitized failure reporting. Six regression tests failed against original code and focused tests passed 14/14 after repair.

Verified baseline environment: Node 22/pnpm 10; readiness 200; 85/85 migrations applied, none pending; specific 0084 journal hash and Neon column confirmed read-only; live pooled connection suite 5/5. Earlier unchanged-baseline full suite: 2844 passed, 3 skipped. Current PR-level lint/build/typecheck/high-severity audit all passed. Complete workspace suite: 2851 passed, 2 existing live-clamd checks skipped. Built HTTP checks: 7/7; existing HTTP security-header checks: 11/11; read-only unbundled catalog diagnostic: 1/1. Four moderate production dependency advisories remain.

Preserved: account IDs and historical identity references, policy, consent, schema, audit transactions, document safeguards, admission flags, live configuration and production settings. No bound-database schema or data writes; unit tests use isolated synthetic databases.

Blocked inspections: GitHub API, open PRs/checks/protection, deployment SHA, production public readiness and real-data presence. Native Git fetch works and origin/main matches frozen baseline. Actual login/email/MFA acceptance not performed. Browser download is proxy-blocked. The built /trust catalog rendered its safe unavailable fallback during header tests; the same service query passed unbundled in a read-only transaction. Diagnose built-driver/proxy initialization before authenticated acceptance.

Next code work after this patch: finish PR-01 identity selection, secure legacy linking/recovery and obsolete runtime/test paths. Read accounts-neon.ts and its consumers before linking changes; matching verified email alone does not satisfy the mandate. Do not delete WorkOS history or mutate production to satisfy tests.

Local contract/correctness and adversarial reviews completed. A recoverable feature-branch commit and incremental Git bundle preserve this patch. Remote publication status is recorded below once attempted. Next verification: diagnose the built-app pooled proxy path, publish the saved network draft, retry the blocked browser/API checks, and inspect required exact-head CI before merge. Keep work packages separately reviewable.

Owner actions: [consolidated table](OWNER-ACTIONS.md). Remaining packages: [work graph](IMPLEMENTATION-TRACEABILITY.md). The full beta transformation remains incomplete.

Remote preservation: native Git push succeeded for public-beta/baseline-and-neon-session-wiring. Implementation commit f6b6aa4 is on origin. A subsequent documentation-only commit records this result. No PR was opened because GitHub API access remained proxy-blocked; no remote CI result, merge or deployment was inspected or claimed. The review description is prepared locally at /workspace/.cloud-tools/beta-pr-body.md.

Continuation after network publication (2026-10-10): GitHub API and canonical production readiness now work. Fetched main advanced to ecced6a9ff87fd79fcee4c59160e3277f77888f2 (#180), with a shared signed-in helper and home-page session links. Its changes were reconciled without removing the home-page behavior. Open drafts #177 (public admission) and #77 (legacy WorkOS staging fixtures) were inspected; neither was merged here. Main's actual browser failures expected WorkOS URLs while receiving correct same-site Neon sign-in redirects.

Current continuation repairs those deployment assertions with a shared exact-origin/sign-in-path guard, raw protected-response checks, and sign-in-page checks. Fourteen URL guard cases reject workspace paths, external origins, deceptive hosts, ports, schemes and credentials; two synthetic deployment cases prove a ready database with an unavailable catalog makes smoke fail. Explicit Node checks remain separate from Vitest discovery and run in CI. The shared public-session helper now uses the provider factory and sanitized failure reporting.

Direct web dependencies now declare the existing locked Neon driver 0.10.4 and ws 8.21.1, making Next's existing external-package configuration resolvable. No package version was upgraded. The rebuilt /trust page renders its actual maintained-route heading instead of the unavailable fallback. This fixes the previously unresolved built-page connection check in this cloud environment. Smoke also checks this page whenever readiness reports a connected, applied database.

Local continuation checks: lint/build/typecheck/high-severity audit passed; web Vitest 1107/1107 across 78 files; pooled driver 5/5; Node guard/deployment checks 16/16; HTTP security headers 11/11; local smoke 11/11 and actual catalog heading verified. The first web run passed its 1107 tests but rejected a Node-only file discovered as a Vitest suite; the Node filename and explicit runner references were corrected, and both runners passed. A loopback-origin mismatch was correctly rejected by the new guard; localhost matched the server's canonical redirect origin. No assertions were relaxed. Previous complete workspace evidence remains scoped to the earlier commit; required current-head CI is still needed.

Remaining cloud blocker: cdn.playwright.dev is reachable but redirects Chromium to storage.googleapis.com, which returned proxy denial. That host plus the installed registry's official fallback playwright.download.prss.microsoft.com were saved in a supplemental network draft, preserving all eight existing explicit destinations and existing bindings. Browser installation and actual browser execution remain unverified locally until applied. Remote CI, PR and deployment status are authoritative in GitHub and must be inspected before merge; this checkpoint records local evidence before that inspection. Full Neon-only migration, secure recovery/linking, staff MFA and authenticated acceptance remain open. No production migration, activation, key rotation or email was performed.

Continuation verification (2026-10-10): installed system Chromium 151 ran all three public suites against the local production build: 81 passed, including real browser accessibility and CSP checks. Compatible browser download remains blocked but is no longer required for current-instance verification. PR #181 first CI run stopped at the static scan because the smoke harness filename was treated as shipped code. The harness was moved to apps/web/tests/auth-redirect.node.mjs, a recognised test directory, retaining all 16 assertions and adding fixture scanning coverage without changing scan rules. Supersedes the earlier local browser limitation; authenticated acceptance and email delivery remain unverified.


Continuation (2026-10-10): provider-aware legacy auth routes

Neon deployments now send bare or stale /callback links to same-site /auth/sign-in without exchanging WorkOS codes, forwarding query parameters or writing a legacy cookie. /api/session-reauth sends Neon to /auth/reauth with the shared safe return-path rule. Explicit legacy deployments retain their WorkOS handler. Callback failures use sanitized server logging.

Regression proof: before the repair, 7 of 13 route assertions failed; afterwards all 13 passed. Focused auth verification passed 39 tests. Local lint, web production build, workspace type checking, all 1115 web unit tests, production dependency audit, 81 browser checks and deployment smoke passed. Both changed routes were also checked through the actual production build. The first browser attempt failed because the test server started in the repository root rather than apps/web; after correcting the external runner working directory and confirming readiness, all 81 passed without changing assertions. Full workspace tests and exact-head deployment checks remain required in CI; these local results do not establish production deployment.

Neon capacity: removed only br-damp-dust-a4xtmktw, the unused merged PR #176 preview, after confirming its merged commit is on main, no open work, no children and no active environment reference. Created isolated preview br-jolly-surf-a4zjgej8 for this patch; production and existing Auth endpoints were retained. Preview settings must be scoped to this Git branch after it exists remotely. No production schema changes, activation, secret rotation, emails or real-account acceptance were performed.

PR-01 remains partial: legacy default/dependencies, stronger account continuity, privileged assurance and real SDK renewal/revocation acceptance remain open. This change repairs routing only.


2026-10-10 continuation: recoverable identity verification

Verified-email-only legacy binding has been removed from provisionNeonAccount. Existing immutable Neon bindings remain authoritative, including when the verified contact email changes. Unbound legacy accounts and conflicting bindings receive the same generic identity_recovery_required result and a denied identity audit event. No account fields are mutated or duplicate accounts created by this denial. Concurrent legacy claims are refused. The unique-constraint race path uses the same recovery result. New verified identities with no matching account retain transactional creation.

withSession releases any claimed invitation before redirecting to /auth/account-recovery. It does not attribute an invitation, touch account activity or grant a workspace on this path. The public recovery page explains verification and offers sign-out without exposing an account ID or reason for conflict. It performs no linking. Controlled original-identity proof, recovery approval and holder notification are still required before actual legacy relinking; this patch intentionally preserves existing records pending that proof.

Regression proof before implementation: three of seven service cases failed and the session recovery assertion failed. Lint, web build and workspace type checking passed. Full workspace tests, browser checks and smoke verification are running under bounded parallelism; their final results are not claimed here. The initial unrestricted test attempt overloaded four CPU cores and a new dynamic-import test exceeded the default timeout. Its timeout is now explicitly 30 seconds, with the security assertions retained. The first full attempt was stopped, not counted as a pass. Exact-head CI and deployment remain required.

Neon capacity: confirmed merged PR #167 preview claude/lucid-lamport-70jivu had its exact latest head on the merged PR, its merge on main, no open work/children/current environment references, no Auth metadata, and only historical preview deployments without production aliases. Removed br-lingering-cherry-a4ikv6l9 and created br-steep-frost-a4nwvyev for this isolated patch, retaining nine branches. Production and all currently referenced Auth endpoints were preserved. No production migration, relinking, emails, secret rotation or beta activation occurred.

Owner reporting requirements are recorded in CLAUDE.md and DEPLOYMENT-ACTIONS.md: after each deployment, explain what changed for whom and show done, in-progress and remaining public beta actions. PR-01 remains incomplete; privileged assurance, Neon-only selection/dependency cleanup and actual auth/recovery acceptance remain open.


Focused continuation verification (2026-10-10): all seven account-provisioning tests passed, including concurrent refusal and unchanged historical account rows. All three session-bridge tests passed, including invitation release, denied workspace execution and recovery redirect. Supply-chain scans passed 7/7 with zero skips. Full workspace/browser/smoke verification remains running; none of those pending outcomes is counted as passed.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
