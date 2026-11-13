# Signed-in acceptance: what blocks it, checked 13 Nov 2026

Plain words. Everything here was read, never changed. Setting values were never read or printed (names only).

## What was checked

| Where | Result |
|---|---|
| The setup report command (`node scripts/check-staging-journey-setup.mjs`) | It crashed on a missing function, so the list of blockers could not be printed. Fixed in pull request #549. Run with nothing set it now lists every journey as BLOCKED with the missing setting names. |
| Vercel (read-only, names only) | One project, `visastack`. No staging project and no custom environment. Preview deployments of branches exist only as cancelled builds (previews are off). |
| Vercel database and sign-in settings | `DATABASE_URL` and `DIRECT_DATABASE_URL` are each ONE record that applies to both preview and production with no branch scope (verified from the project's variable list, names, targets and scope only). A preview deployment of any branch without its own branch-scoped record therefore uses the production database; that is exactly what the isolation check refuses, so no preview can serve as staging today. `NEON_AUTH_BASE_URL` has two separate unscoped records, one for preview and one for production; values are not readable, so whether sign-in differs between them is UNKNOWN and must be checked by the owner. Several older branch-scoped preview records exist for named branches. |
| Staging settings the workflow needs | None of `STAGING_ATTESTATION_SECRET`, `STAGING_VERCEL_TOKEN`, `E2E_*` or the `NEON_STAGING_*` accounts exist on the Vercel project (names searched). GitHub secrets and variables are unreadable to tools, so whether they exist there is unknown. |
| Neon (this session's connection) | Shows two other projects only (`corridra-nonprod`, `Flowtal`). The VisaStack Neon project is not visible to this connection, so the staging schema, its accounts and its branch inventory could not be checked here. |
| Vercel connection | The Vercel tool connection is not authorised for the team (it reported the team as not found); read-only requests through the proxy-injected credential worked. |
| Mail capture | No capture inbox exists (guest journey only). The flagship journey does not need one if the agency invitation is already accepted. |

## Exact minimal owner actions (nothing here has been done)

1. Create a staging deployment whose database and sign-in are NOT production's: a Vercel custom environment (or a second project) with its own `DATABASE_URL`, `DIRECT_DATABASE_URL` and `NEON_AUTH_BASE_URL` pointing at the staging Neon branch and a staging Neon Auth project, built from the revision under test. Run every migration on that staging database (including 0132 to 0134 and, once approved, 0135).
2. In the GitHub environment `staging-journeys` (deployment rule: `main` only) set the variables `E2E_STAGING_BASE_URL`, `E2E_STAGING_DEPLOYMENT_ID`, `E2E_SYNTHETIC_ISOLATION_VERIFIED` (`true` only after step 1 is checked), `E2E_TRAVELLER_ID`, `E2E_AGENCY_ORG_ID`, `E2E_UNRELATED_AGENCY_ORG_ID`, `E2E_CASE_ID`, `E2E_EXACT_COPY_SERVICE_VERIFIED`, `E2E_ACCESS_SEEDED`, and the secrets `STAGING_ATTESTATION_SECRET` (also set on the deployment), `STAGING_VERCEL_TOKEN` (read only) and the six `NEON_STAGING_*` account settings for three synthetic accounts (traveller, agency admin, unrelated agency admin) with verified addresses and made-up names. Full list and meanings: `docs/operations/staging-journeys.md`.
3. Seed on the staging database: the traveller record, an agency organisation (admin as owner), a second unrelated organisation, and a grant from the traveller to the first agency that the agency has accepted.
4. Run the workflow "Neon staging signed-in journeys" from `main`, suite `all`, and read the "Signed-in journey setup" summary first.
5. For the same journey on production-like mail: a capture inbox (only for the guest journey).

## Status of the journeys

Every journey is BLOCKED. None was run, none is labelled passed. The flagship journey spec (traveller and agency on different accounts, unrelated agency refused, several saved documents answered together, exact copies pinned, accept and send back, correction keeps history, revocation, receipts after a later update, phone and desktop accessibility) is written in pull request #554 (spec not run; its guards pass) and cannot run until step 1 to 3 are done.
