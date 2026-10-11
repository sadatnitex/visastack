# Actual Neon staging acceptance

The legacy WorkOS workflow is manual diagnostics only. Missing identities or a skipped journey now fail visibly. It has no production URL fallback and cannot establish Neon Auth acceptance. A successful legacy run must execute its configured journeys with zero skipped checks.

The separate `Neon staging route evidence (CF-09 partial)` workflow signs in through the real Neon form, captures all ten actual reference routes at 1600 x 1000 and at 390 x 844 with light and dark preferences, checks serious/critical accessibility findings and horizontal overflow, and tests selected cross-account/role refusals. It uses five independent synthetic identities. It does not mock authenticated pages. Authentication traces, automatic failure screenshots and video are off; captures occur only after the intended route has loaded. Raw authenticated diagnostic output is not uploaded.

Before execution, verify an isolated staging database, an isolated Neon Auth instance and approved synthetic fixtures. Set `E2E_SYNTHETIC_ISOLATION_VERIFIED=true` only after recording that evidence. This attestation is a prerequisite, not automated proof of database/auth isolation. The preflight separately verifies a READY non-production Vercel deployment, exact commit, project and immutable deployment address through the Vercel API. Never point staging identities at production or a moving alias.

Required Actions variables: `E2E_STAGING_BASE_URL`, `E2E_STAGING_DEPLOYMENT_ID`, `E2E_SYNTHETIC_ISOLATION_VERIFIED`, `E2E_TRAVELLER_ID`, `E2E_CASE_ID`, `E2E_AGENCY_ORG_ID`. Required secrets: `STAGING_VERCEL_TOKEN` and `NEON_STAGING_{TRAVELLER,OTHER_TRAVELLER,AGENCY_ADMIN,AGENCY_WORKER,PLATFORM_ADMIN}_{EMAIL,PASSWORD}`. Use distinct synthetic accounts, including an assigned agency worker and a genuine platform role. The selected traveller/case must be owned by the traveller fixture. No passwords, connection strings or tokens belong in documentation or screenshots.

Current status: execution BLOCKED. No verified isolated staging deployment, independent Neon identities or approved synthetic fixture bindings are recorded in this session. The new workflow and route checks are implementation, not live acceptance evidence. Neon branch capacity remains a dependency; do not delete an unproven branch or reuse production to unblock these checks.

Even after these checks pass, CF-09 remains incomplete until actual PDF comparisons and all significant workflows pass: versioned profile persistence, document upload/real processing/quarantine/preview/download, exact grant acceptance/pause/resume/revocation, agency assignment/evidence/review/export boundaries, specialized admin actions, mobile/keyboard discovery, failure/recovery states and required operational acceptance. A route capture or successful CI run cannot close that ledger by itself.


## Independent resource binding proof

Before login, the preflight now requires a separate `STAGING_ATTESTATION_SECRET`, configured only on the approved preview and in Actions. `/api/staging/attestation` is unavailable in production or without the explicit staging-isolation flag, and compares the separate bearer secret before reporting non-secret configuration identifiers. It never connects to the database or returns database usernames/passwords, cookies or keys. The preflight verifies the exact code revision and compares the preview database endpoint and Neon Auth origin against production bindings read privately through the Vercel API. Reusing either production resource blocks the run before any synthetic credentials are sent.

These checks prove deployment/configuration separation; they do not prove a copied branch contains only synthetic data. Approved empty schema/fixtures, separate document processing/storage bindings and all lifecycle journeys still need evidence. Existing production credentials and databases are not changed by this module. Current execution remains blocked pending isolated staging provisioning and verified synthetic fixtures.


## Legacy acceptance retirement checkpoint

The historical WorkOS acceptance workflow is explicitly retired for the Neon product: a manual dispatch reports blocked, never a successful skipped journey. The retained legacy authentication implementation and diagnostic spec remain available. Actual Neon tests use their dedicated guarded staging configuration; ordinary anonymous/public checks keep their existing collection behavior. No previously verified authenticated journey is removed or counted as passed. Deployment/resource configuration proof still cannot establish complete PDF, fixture, storage or lifecycle acceptance.
