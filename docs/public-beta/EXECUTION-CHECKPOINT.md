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
