# Coordinated public beta work: PR-02 through PR-05

The owner requested these four packages together on 2026-10-10. They share one engineering branch and full verification pass. This checkpoint records implemented changes and outstanding acceptance separately; it does not certify all four packages complete.

| Package | Implemented in this batch | Acceptance still required |
| --- | --- | --- |
| PR-02 | Signed Resend rejection events update the outbox; late bounce/complaint supersedes delivery; replay and later delivery cannot undo failure | Actual Neon SMTP and Resend delivery, shared allowance measurement, legal acknowledgement and anti-bot registration protection |
| PR-03 | New agencies receive an explicit zero-price founding subscription atomically; paid and legacy offers remain intact; complimentary access bypasses payment restrictions while retaining permissions and infrastructure quotas; real-record safety is evaluated separately from commercial certification | Live founding journeys, registration safeguards, reviewed fair-use budgets, existing-agency offer reconciliation without unapproved backfill |
| PR-04 | Owner original-download action earns fresh authentication, uses the existing exact-version policy and revocable signed delivery route, and rejects raw upstream URLs | Real protected scanner with fresh signatures, actual protected-content redaction, managed key custody/rotation/recovery, independent database and file backup plus verified restore |
| PR-05 | Document wallet exposes original downloads only for usable documents with configured signing/storage safeguards; new agency setup records complimentary access without marking itself verified; pending organizations can invite their internal team | Consenting authenticated traveller, family and multi-agency lifecycle acceptance, mobile/retry behavior, tenant isolation and post-revocation download acceptance |

The existing Traveller Free catalog key is preserved. Traveller access already uses that canonical default without an organization subscription. No account ID or existing customer record is rewritten. No schema migration or production data backfill is introduced.

Operational readiness includes configured identity, database, private storage, real scanner, managed keys, conversion, fresh authentication, deletion, authorization, consent, backup/restore, authenticated acceptance, incident ownership and notices. It remains false while the managed-key implementation and required safety evidence are missing. Commercial claims retain their independent certification. This batch does not activate public registration or real-document intake.

New agency subscriptions have zero price and no payment-method prerequisite. The founding offer does not bypass record grants, consent, verification status, file limits, reservation consistency or platform resource safeguards. Legacy no-plan fixtures explicitly represent existing organizations, separately from new founding organizations. Paid subscription tests remain authoritative.

Owner download checks applicant ownership before requesting authentication and rechecks document policy through the existing service. Client fields cannot supply assurance. Delivery stays on the current deployment's authorized blob route. Redacted download remains unavailable because stripping active content alone does not remove protected document content.

## Verification checkpoint

The new owner guard was removed temporarily: its hostile-owner test failed. Restoring the guard passed all five action tests. Initial focused service checks exposed old no-plan fixture assumptions; those fixtures now represent legacy organizations explicitly. The corrected service checks and shared full verification are pending at this checkpoint. No pending check is recorded as passed.

## Provider and acceptance prerequisites

Use the existing Neon Auth endpoint and the verified sender noreply@vs.obsidianglobal.studio. Provider credentials must remain in protected environment settings. Complete actual email acceptance only with a consenting recipient. Scanner/key/backup deployment requires an existing approved service or a concrete cost proposal before any recurring service is created. Real beta activation and production migrations remain separate owner decisions under the public beta directive section 0.2.

### Corrected focused verification

The corrected notifications, organizations, entitlements and plans suites passed 135/135 tests. Download action, document-wallet and capability checks passed 30/30; readiness/capability checks passed 36/36 before the additional configured-download assertion. Type checking passed across all eight packages. Subsequent additions, including the pending-agency internal invitation assertion, will be covered by the shared full run. A reviewed obsolete merged preview was replaced with the coordinated branch preview; Neon inventory is nine and the production/default branch is preserved.

### Full application checks and browser correction

The full workspace run passed: services 1,344 tests, web 1,123, adapters 325, database 34, policy 32, core 2 and load 10. Three existing live-service cases were skipped. The separate read-only pooled database run passed five tests against the existing allowed endpoint, covering the database live case; the two real-ClamAV cases remain unverified. The new preview pooled request was refused with HTTP 403 by the cloud hostname policy. Its exact pooler, Auth and current preview deployment hosts are saved in the environment draft, pending publication.

Lint, production build, type checking, the high-severity audit gate and supply-chain checks passed. The first browser run passed 81/82 checks. Its injected-markup check assumed a missing image would fail within 500 ms; the script-element CSP event arrived, but the image-handler event did not arrive before that fixed deadline. The test now awaits both actual blocked directives with a ten-second failure deadline and retains every assertion. The focused corrected test passed and observed both directives. Full browser rerun and smoke completion are pending at this checkpoint. Application source and dependencies are unchanged by this browser correction, so their completed full checks are retained.

The previously missing STEP_UP_SIGNING_SECRET was initially configured with distinct production and branch-preview keys. No existing binding was replaced. Actual authenticated download acceptance is still pending. The owner selected existing scanner/key/backup services and will identify them; no new paid service was purchased.

PR #183 production verification completed after correcting the verification script to accept a relative same-origin sign-in redirect. All required merge-commit CI and deployment checks passed, readiness returned ready, the recovery page rendered, anonymous workspace access stayed denied and Neon retained nine branches.
