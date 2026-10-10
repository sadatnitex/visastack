# Source and dependency baseline

Frozen source and fetched origin/main: `698442a4124fce7f966aca2bee38b9f0e16bbd98`, 2026-10-10. The historical reference in the mandate is superseded for analysis by this fetched main. [Exact tracked-path inventory](SOURCE-INVENTORY.txt) covers all 885 baseline paths; generated tools, dependencies and the two owner documents were untracked before implementation.

| Layer | Baseline paths | Boundary |
| --- | ---: | --- |
| apps/web | 332 | UI, Server Actions, HTTP routes, session bridge and provider composition |
| packages/services | 146 | Transactional use cases, audit, consent and durable jobs |
| packages/policy | 6 | Authoritative default-deny object decisions |
| packages/core | 8 | Domain vocabulary, modes and contracts |
| packages/db | 185 | Drizzle schema, journal, clients and migrations |
| packages/adapters | 59 | Storage, scanning, AI, email and key interfaces |
| packages/i18n | 6 | Existing localization architecture; new translation deferred |
| packages/load | 14 | Synthetic dataset and load tooling |
| docs | 98 | Historical specifications and evidence |
| .github | 10 | Existing checks and deployment verification |

Remaining inventory paths are shared configuration, scripts and editor settings. File counts are an index, not proof of feature completeness.

Auth chain: middleware -> Neon Auth session -> identity port -> withSession -> provisionNeonAccount -> canonical accounts.neon_user_id -> service/policy transactions -> atomic audit. Domain account IDs and historical workos_user_id references must survive the migration.

This patch's consumers: root layout and pilot-denial page read createIdentityPort().currentIdentity() without provisioning; workspace sign-out calls signOutCurrentUser(). Identity selection, Neon session age, reauthentication, public admission, provider factory and legacy linking remain separate continuation work.

Data and permission references: [data model](../architecture/data-model.md), [permission model](../architecture/permission-model.md), [document pipeline](../architecture/document-pipeline.md), [tenant matrix](../security/tenant-isolation-matrix.md), [identity boundary](../security/identity-and-step-up-boundary.md).

Inspection limits: native Git fetch succeeds; GitHub API requests for open PRs and exact-head check runs are proxy-forbidden. Production public readiness is also proxy-forbidden. Production/preview deployment SHAs, open PR conflicts, branch protection and whether production contains real customer records are unknown. No remote CI or deployment claim is made.
