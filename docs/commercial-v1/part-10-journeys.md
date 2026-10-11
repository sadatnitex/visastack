# Part 10 section 3: journeys J01 to J15

Written 2026-10-06. **No journey was executed through the real UI in this session**, because no real sign-in is possible here (the sign-in provider is unreachable from the sandbox) and no staging identity secrets are confirmed in the repository (the staging job was skipped on the last run of main; PR #77 records that even the first identity pair had never been created). Service tests are listed for reference and do not substitute, per the directive.

Environment for the one live check: production (`visastack-five.vercel.app`), deployed commit `e62284e`, no identity, no fixture. Failure-path result column is empty for every journey because none ran.

| ID | Journey | Screens involved | Automated coverage that exists | State | Why |
|---|---|---|---|---|---|
| J01 | Independent traveller | /app, /app/applicants, profile, documents tabs | `authenticated-workspace.spec.ts` single-identity tests (written, never run against staging) | BLOCKED | No staging sign-in secrets confirmed in the repository; the staging job was skipped on the last main run |
| J02 | Agency onboarding | /app/agency, create organisation, verification by an administrator | agency page tests, `organizations.test.ts` | BLOCKED | Needs a traveller identity and a platform administrator identity |
| J03 | Agency invites traveller | /app/agency/<org>/clients invitation form, /app/client-invitations/accept | `client-invitations.test.ts`, clients page test | BLOCKED | Needs the agency identity and a separate invited identity |
| J04 | Repeat case | applicant workspace, missions tab, new case from an existing profile | `missions.test.ts` | BLOCKED | Needs sign-in |
| J05 | Expiry replacement | /app/applicant/<id>/expiry, documents tab upload of a replacement | `expiry.test.ts`, documents page tests | BLOCKED | Needs sign-in and the scanner (production scanner is unconfigured) |
| J06 | Sharing | applicant sharing tab, /app/shared, shared workspace | `sharing.test.ts`; cross-account test bodies now written | BLOCKED | Needs the second identity (tests 1 to 3 in the cross-account block) |
| J07 | Agency preparation and readiness | /app/mission/<id>, readiness list, evidence requests | `missions.test.ts`, mission page work from earlier chunks | BLOCKED | Needs the agency fixture and two identities |
| J08 | Applicant truth | acknowledgement panel on a snapshot | `acknowledgements.test.ts` | BLOCKED | Needs sign-in and step-up with a real person |
| J09 | Outcome and feedback | outcome and feedback forms | `outcomes.test.ts`, `feedback.test.ts` | BLOCKED | Needs sign-in |
| J10 | Change agency | revoke one agency, share with another | `sharing.test.ts`, `agency.test.ts` | BLOCKED | Needs two agency identities (Agency A and B) |
| J11 | Family or sponsor contributor | /app/contributor-requests/accept | `contributor-requests.test.ts` | BLOCKED | Needs a separate contributor identity |
| J12 | Owner operations | /app/admin overview, audit, organisations, privacy | admin page tests (`page.test.tsx` files) | BLOCKED | Needs a platform administrator identity |
| J13 | Public trust | /trust and /trust/<route> | `trust/[packKey]/page.test.tsx`, `a11y-pages.test.tsx`, `ux-public.spec.ts` (/trust at 320, 360, 390) | BLOCKED | Executed in part: the live catalog loaded (HTTP 200, one top heading, no routes published). The route page could not be seen because an administrator must author and publish a route first |
| J14 | Export and exit | /app/privacy export and deletion request | `account-export.test.ts`, `erasure.test.ts`; spec tests for export and deletion cancel | BLOCKED | Needs sign-in |
| J15 | AI administrator provider change | /app/admin/ai-settings | `ai-provider-config.test.ts` | BLOCKED | Needs an administrator identity and a live provider |

**Totals:** 15 BLOCKED, 0 PASS, 0 FAIL, 0 NOT_EXECUTED (every row waits on something outside this session).

## What unblocks them

1. Create the two synthetic staging identities (PR #77 has the code half) and add `WORKOS_STAGING_TEST_EMAIL/_PASSWORD` and the `_2` pair as repository secrets.
2. Create the staging agency fixture (Agency A verified, the second identity a non-admin member, one assigned and one unassigned applicant) and set the four `E2E_AGENCY_*` repository variables.
3. Dispatch `WorkOS Staging E2E (authenticated)` by hand on main, or let it run on a Production deployment. Then record, per journey: deployed commit, identities, fixture id, steps, result, the Playwright report artifact, and the failure-path result.
4. A platform administrator identity and a published route are also needed for J02, J12, J13 and J15.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
