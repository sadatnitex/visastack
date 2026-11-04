# Signed-in journey testing

Status: written 4 Nov 2026 by the Product Excellence programme, lane F. Nothing in the second tier has been run against a deployment: the staging project is an empty schema with no sign-in accounts, no deployment bound to it and no secrets. This page says what exists, what it proves, and the exact setup still needed. It never describes an untested journey as passing.

## The truth this is built on

- No signed-in browser test can run in a pull request today. The app has no test sign-in mode (it must not), the server cannot be pointed at a local database by settings alone, and pull requests get no preview deployment.
- The old signed-in suite (`apps/web/e2e/authenticated-workspace.spec.ts`, written for WorkOS) is run by no workflow. It is kept as it is; retiring it is a separate decision for the owner. The default Playwright run now ignores it by name so nobody starts it by accident.
- Nothing here weakens a gate. A journey that cannot run FAILS with a message that starts with `BLOCKED:` and names the missing setting. It is never skipped (a skip looks like a pass in a summary) and never passed.

## Three tiers

| Tier | What it is | Where it runs | What a pass means |
|---|---|---|---|
| 1a | The real components of four screens that exist today (document wallet, case page card, evidence request form, agency Cases list) mounted in a browser with made-up data and stand-in server actions | Every pull request, inside the existing "No-secret Playwright checks" job (`journey-screens/` in `pr-browser-checks.yml`) | The screens look and read right at five widths, pass axe WCAG 2.2 AA, keep a usable keyboard order with a visible focus mark, and an anchor-only Cases link opens its case. It says nothing about sign-in, who may see what, or stored data |
| 1b | A full local stack with an injected session (spike, see below) | Not built | Nothing yet |
| 2 | Real sign-in with synthetic accounts against an isolated staging deployment, real database, real files | On demand only: `.github/workflows/neon-staging-journeys.yml` (`workflow_dispatch`, main only, no schedule, no production target) | The listed journeys ran and passed on staging. Nothing about production |

## Tier 1a files

- `apps/web/e2e/fixtures/journey-screens.fixture.tsx`: the four screens, built from the product's own components. Server work is replaced by stand-ins that answer "nothing was changed" (`standInServerActions` in `e2e/scroll-budget/support.ts`, opt in).
- `apps/web/e2e/journey-screens/journey-screens.spec.ts`: the checks. `signed-in-support.spec.ts` in the same folder holds the parts of the staging suite that need no deployment (how a missing setting fails, the second-step code generator, the promise detector).
- `apps/web/e2e/fixtures/synthetic-passport.ts` and `.spec.ts`: the made-up passport page (below).

Local evidence, 4 Nov 2026 (after merging the integration branch at a924f174): the command `playwright test journey-screens/ fixtures/synthetic-passport.spec.ts` ran 54 tests in 3 files (39 screen checks in `journey-screens.spec.ts`, 10 helper checks in `signed-in-support.spec.ts`, 5 passport checks in `synthetic-passport.spec.ts`) and all 54 passed, on a developer machine with one worker, against the app running in development mode with a throwaway config that only points Playwright at the sandbox browser. A production build could not be made there (the machine's memory limit killed it twice), so this was not run against a production build; the pull request job uses one. The scroll budget specs that share the test support code (WP-SB1, SB2, SB5: 16 tests) and the shell checks in `ux-public.spec.ts` (11 tests, earlier run) also passed. Each guard was proved by breaking the real code once and watching its test fail: the Cases opener, the decision buttons' names, the pack choice's name, sideways overflow, the 44px rule, the preview rule, the single marked stage, the required traveller choice, and evidence being attached by path.

The "evidence request" screen is the form as it stands today. It has no "which copy to send" control; that belongs to the exact-copy work (Lanes D and E) and is not tested here.

## Tier 2 journeys and their status

Status words: PASS locally means a run on a developer machine; BLOCKED means it cannot run yet and fails if it is started.

| Journey | Spec | Needs | Status |
|---|---|---|---|
| Traveller: first document, safety state, find again, clearer copy, same file twice, owner-safe page | `traveller.spec.ts` | traveller account, traveller id | BLOCKED: no staging accounts or deployment |
| Case: UK tourism pack match, unsupported route says so, country and place of application stay separate, no approval promise | `case-pack.spec.ts` | traveller account, a seeded UK tourism pack, a destination with no pack | BLOCKED, and depends on the checklist pack work (Lane C) for the wording of "not supported" |
| Isolation: an unrelated agency cannot open another agency or a traveller; denied looks the same as missing | `agency-isolation.spec.ts` | traveller, agency, unrelated agency accounts and ids | BLOCKED: no staging accounts |
| Exact-copy loop: ask, choose copy, agency sees exact copy, send back with reason, clearer replacement, accept, old receipt, end access | `agency-loop.spec.ts`, then `agency-loop-revoke.spec.ts` last | the above plus the exact-copy service deployed and migrated on staging | BLOCKED by design until the owner confirms Lanes D and E are merged and migrated there (see "Dependency on Lanes D and E") |
| Guest private request: issue, open the link, email code, upload, send, agency sees the same file | `guest-request.spec.ts` | agency account, a capture inbox, the collection desk switched on | BLOCKED: no capture inbox |
| Widths, accessibility, keyboard, Cases anchor, 404, session expiry, page timings | `responsive-a11y.spec.ts`, `session-expiry.spec.ts`, `performance.spec.ts` | traveller and agency accounts, a case id | BLOCKED: no staging accounts |

Not automated, on purpose: the agency invitation emails and the traveller accepting them (they need a capture inbox for the traveller's own address). The loop starts from an agency that has already been granted access (`E2E_ACCESS_SEEDED`). The page timings are recorded as evidence and carry no pass line: nobody has agreed a speed target and a shared runner on staging says little about production.

## What the suite does to be safe

- Signs in through the real sign-in form only (`signed-in/support/session.ts`). There is no minted cookie and no shortcut. `scripts/no-auth-bypass.test.mjs` reads the application code and the journey code and guards against any code that mints or trusts a session outside the sign-in library (one identity reader, cookie names and the cookie secret confined to known files, no bypass settings, no stored browser state, no cookie in a header, cookies re-added in known places only). It is a source-text check: it forces a review when someone adds such a door, it is not a proof that none exists.
- Three distinct accounts, never one on both sides: a traveller, the agency that asks, and a second agency with no link to either. The run refuses to start if two share an address or an organisation.
- Never prints a password, a cookie or a token. Cookies from the real form are kept in memory for one run and never written to disk. Traces, video and automatic screenshots are off. The setup report prints setting names only.
- The specimen passport is drawn at test time from the ICAO Doc 9303 specimen holder (a country that does not exist) with a "SPECIMEN - NOT A REAL DOCUMENT - TEST DATA ONLY" header and a machine-readable zone whose check digits are correct. No image or document is committed.
- `scripts/check-staging-target.mjs` refuses anything but an immutable non-production deployment of this exact revision, whose own attestation proves it uses a database and Neon Auth project different from production's. `scripts/check-authenticated-results.mjs` refuses a run with a skipped, retried or failed test.

## Owner setup still needed

Names only; values go in the repository's secret and variable settings (never in a file). `node scripts/check-staging-journey-setup.mjs` prints, per journey, what is still missing.

1. A staging deployment bound to the staging database and a staging Neon Auth project, with all migrations applied to that database, built from the revision being tested. Variables: `E2E_STAGING_BASE_URL`, `E2E_STAGING_DEPLOYMENT_ID`, `E2E_SYNTHETIC_ISOLATION_VERIFIED` (set to `true` only after checking the isolation). Secrets: `STAGING_ATTESTATION_SECRET` (at least 32 characters, also set on that deployment), `STAGING_VERCEL_TOKEN` (read only). Create a GitHub environment named `staging-journeys` with a deployment branch rule that allows `main` only, and put every secret listed on this page in that environment (the workflow's job names it, so it cannot read them otherwise). The workflow gives the Vercel token and attestation secret only to the target check, the account passwords, second-step secrets and inbox token only to the journey run, and nothing secret to the install steps.
2. Three synthetic Neon Auth accounts on the staging project, with verified addresses and made-up names. Secrets: `NEON_STAGING_TRAVELLER_EMAIL`, `NEON_STAGING_TRAVELLER_PASSWORD`, `NEON_STAGING_AGENCY_ADMIN_EMAIL`, `NEON_STAGING_AGENCY_ADMIN_PASSWORD`, `NEON_STAGING_UNRELATED_AGENCY_ADMIN_EMAIL`, `NEON_STAGING_UNRELATED_AGENCY_ADMIN_PASSWORD`.
3. Seeded records on the staging database. Variables: `E2E_TRAVELLER_ID` (the traveller's record), `E2E_CASE_ID` (a case of that traveller that the agency can see), `E2E_AGENCY_ORG_ID` (the agency organisation, with the agency admin as owner), `E2E_UNRELATED_AGENCY_ORG_ID` (a second organisation with the unrelated admin as owner and no link to the first).
4. For the case journey: a supported UK tourism requirement pack published in staging (`E2E_UK_TOURISM_PACK_SEEDED` set to `true`, and `E2E_UK_TOURISM_PACK_LABEL` set to the label the case shows for it), and the name of a destination that has no published pack (`E2E_UNSUPPORTED_ROUTE_DESTINATION`).
5. For the exact-copy loop (Lanes D and E): `E2E_EXACT_COPY_SERVICE_VERIFIED` set to `true` only once that work is merged, deployed to the staging deployment and its migration applied to the staging database; `E2E_ACCESS_SEEDED` set to `true` once the traveller has granted the agency access and the agency has accepted it.
6. For the guest journey: a capture inbox that answers the contract in `apps/web/e2e/signed-in/support/inbox.ts` (the owner provides it; the staging mail setting must send to it). Variables: `E2E_GUEST_INBOX_URL`, `E2E_GUEST_RECIPIENT_EMAIL`. Secret: `E2E_GUEST_INBOX_TOKEN`. The collection desk switch must be on in the staging deployment.
7. Only if staff sign-in later gets a second step: `NEON_STAGING_TRAVELLER_TOTP_SECRET`, `NEON_STAGING_AGENCY_ADMIN_TOTP_SECRET`, `NEON_STAGING_UNRELATED_AGENCY_ADMIN_TOTP_SECRET`. The product has no such step for ordinary accounts today; the suite reads these only if the sign-in page asks for a code, and is BLOCKED naming the secret if it asks and none is set.

Order of the specs: the step that ends the agency's access (`agency-loop-revoke.spec.ts`) would break every spec that needs the grant, so it is not left to file-name order. `playwright.signed-in.config.ts` has two stages: `journeys` (everything else) and `revocation` (that one file), and `revocation` waits for `journeys`. The `all` suite runs both in that order; any single suite is run with `--no-deps` so it runs only its own files, still in the same order (the `loop` suite runs the loop, then the revoke step). If the first stage has a failing test the last stage does not run, which also fails the run. `scripts/staging-journeys.test.mjs` fails if any other spec revokes, pauses or re-grants access, or if the config and the setup script disagree on which specs run last.

Reset: the revoke step ends the agency's access, and the traveller journey adds files, so the owner re-seeds the grant and removes the added files before the next run. No reset script exists yet; staging data is synthetic and may be recreated.

## Dependency on Lanes D and E

`agency-loop.spec.ts` is written against the behaviour the design documents promise (the traveller picks which stored copy answers a request, the agency's review names that exact copy, a sent-back request can be answered by a clearer copy, an earlier receipt still names the copy it was for, ending access stops fresh retrieval). Neither lane was merged when this was written, so every control name it looks for is held in one place, `apps/web/e2e/signed-in/support/selectors.ts` (`AWAITING_LANES_D_E`), as a guess to confirm. The spec fails closed twice: it is BLOCKED unless the owner has set `E2E_EXACT_COPY_SERVICE_VERIFIED`, and each step is BLOCKED if the deployed page does not show the control (`requireExactCopyUi`). It must be updated against the real wording before its first run, and its first green run is not evidence until it has been read against the deployed pages. The second-agency isolation check and the "revoked access looks missing" check also need the deployed service and its migration before they can be called final.

## Running it

- Pull requests run Tier 1a and the helper checks automatically. Locally: build the app, start it with the placeholder settings in CLAUDE.md section 6, then `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test journey-screens/ fixtures/synthetic-passport.spec.ts` from `apps/web`.
- Tier 2: Actions, "Neon staging signed-in journeys", Run workflow on main, pick a suite (or all). It must be run from main. Read the "Signed-in journey setup" summary first.
- Release evidence for a run: environment (staging deployment URL and id), the revision, the roles used, the suite, pass or BLOCKED per journey, and the evidence files the run uploads. Page captures (`<page>-<width>.png`), page timings (`timing-<page>.json`), the safety state text and lighter axe findings are written into the run's output folder by the specs and uploaded as the `signed-in-journey-evidence` artifact (retained 7 days); the upload fails if a run that executed kept none. Nothing else is promised as evidence. A green run covers staging only and never supports a claim about production security.

## Tier 1b: local full stack (spike, not built)

Idea: run the app and a local Postgres in a pull request job and open signed-in pages without the hosted sign-in service, by giving the browser a session the app would accept. Why it is attractive: it would put real server code, real permissions and real data in every pull request. Why it is not built: it needs code that creates session cookies, and that is exactly the kind of code that must not exist casually in a product where a session is the only key to a person's documents.

What it would take, so that it can be reviewed before anyone builds it:

1. A bridge so the server's database driver can reach a local Postgres (the server speaks a hosted driver; the repository's load-test package already has a socket bridge and a small `/sql` shim that could be reused).
2. A harness-only function, kept out of the application folder and out of the production build, that creates the two cookies the sign-in library reads, signed with a secret generated fresh inside the job, set only for a `localhost` origin. A guard would refuse to run for any other origin or any secret that was not generated in that job.
3. A pull request job, not required, labelled "session injected, local database" in its name, so no one reads it as sign-in evidence.

Unproven and risky: whether the library's secure cookie names are accepted over plain `http://localhost`; whether the hosted driver accepts a bridge on a local address; whether the session service the library also calls on every request can be answered locally; and the maintenance cost of tracking the library's cookie format. It needs a security review before any code is written, and the review should decide whether the value (real server code in pull requests) is worth keeping a session-minting function in the repository at all. Until that review, Tier 1a plus the real-sign-in Tier 2 is the supported approach.

## Known gaps

- Tier 2 selectors were read from source at the base revision and have not met a deployed page.
- Reading and the "new copy" suggestion run in the background; the traveller journey reloads the documents page for up to 150 seconds and fails if a suggestion never appears.
- Guest identity proof depends on a capture inbox the owner does not have yet.
- Responsive and accessibility checks on real pages gate only on serious and critical axe findings; lighter ones are attached to the report.
