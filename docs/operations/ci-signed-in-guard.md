# Signed-in guard on the CI machine

Owner goal (17 Nov 2026, board item WAL1b, approved under "I agree with the rest, your recommended options"): "A permanent made-up test traveller and agency login in CI so every upgrade is checked on the real pages, not on fixtures." Made-up data only.

## What it does

Every pull request that changes more than docs gets one extra job, "Signed-in guard (made-up people)" (`.github/workflows/pr-signed-in-guard.yml`). It is separate from the three required checks and is not itself required. It:

1. builds the app exactly as production does;
2. starts a throwaway Postgres (the same pinned `postgres:18` image the CI database tests use) and an empty database on 127.0.0.1;
3. starts a stand-in sign-in service on 127.0.0.1 (`apps/web/ci-signed-in/stand-in-auth.mjs`);
4. starts the unchanged production build (`next start`) pointed at both;
5. seeds a made-up traveller and a made-up agency admin through the real service functions;
6. runs the browser tests in `apps/web/ci-signed-in/*.guard.ts` as those two people.

No product code changes. Sign-in middleware, the account mapping, session age, pilot access, permissions and audit all run for real; only the two outside services (Neon Auth and the Neon database) are replaced by local stand-ins on the CI machine.

## How the pieces fit

| Piece | File | What it does |
|---|---|---|
| Runner | `apps/web/ci-signed-in/run.sh` | The whole run, identical on CI and locally. Refuses ports already in use, starts and stops everything, deletes a run folder it made itself, and prints both logs on failure. |
| Stand-in sign-in | `apps/web/ci-signed-in/stand-in-auth.mjs` | HTTPS on 127.0.0.1 only. Answers the one call the pinned Neon Auth SDK (`@neondatabase/auth` 0.5.0-beta) makes to learn who owns a session cookie: `GET <base>/get-session`. Knows two made-up people; anything else gets "nobody is signed in". |
| Certificate | made by the stand-in per run | Self-signed, one day, for 127.0.0.1 and localhost. Only that run's `next start` trusts it (`NODE_EXTRA_CA_CERTS`). The app requires an `https://` sign-in address, which is why TLS is used. |
| Session tokens | `tokens.json` in the run folder | Random per run, owner-only file. Never in the repository. |
| Database preload | `apps/web/ci-signed-in/db-preload.cjs` | Loaded into `next start` with `NODE_OPTIONS=--require`. Starts the repository's loopback bridge (`packages/db/src/pg-bridge.ts`) so the production database driver reaches the local Postgres. Its bridge port is fixed by the runner (`CI_DB_BRIDGE_PORT`, default 45432), so the driver is pointed at it before the first request, and the runner waits for the bridge before calling the server ready. Refuses any database not on 127.0.0.1 (the address itself, not `localhost`) and any Vercel machine before the server starts. Starts only when the runner sets `CI_DB_PRELOAD_START=1`. |
| People | `apps/web/ci-signed-in/people.json`, `people.ts` | Fixed made-up identities (`@example.test` addresses); `person(role)` adds this run's token, `seeded()` this run's record ids. |
| Seed | `apps/web/ci-signed-in/seed.ts` (Playwright global setup) | Uses the preload's database rule (one rule, so the seed writes where the app reads), refuses a database that was used before, runs the shipped migrations, then creates the traveller (consents, profile, one case, two documents) and the agency (created by its admin, activated by a made-up platform reviewer, shared with by the traveller and accepted by the admin) only through `@visastack/services`. A schema or service change that breaks this shows up at typecheck. |
| Sign-in helper | `apps/web/ci-signed-in/session.ts` | `signInAs(context, role, baseURL)` puts the person's session cookie in the browser (no sign-in form) and refuses any address but this machine. |
| Browser config | `apps/web/playwright.ci-signed-in.config.ts` | Refuses any base URL but localhost; 2 workers. Test files end in `.guard.ts` so the unit test runner never picks them up. |
| Guards | `scripts/ci-signed-in.test.mjs` (in `pnpm run test:node`) | Fails if any app or package file names the guard, another workflow runs it, its workflow gains secrets or a required check's name, the stand-in leaves loopback or answers more, the preload accepts a remote database or Vercel, or the installed SDK changes the call the stand-in answers. |

## Why it cannot reach production

- Nothing under `apps/web/src` or `packages/` imports it (guard test), so none of it is in the deployed bundle, and there is no switch in the app to turn on.
- The stand-in and the bridge listen on 127.0.0.1 only; the certificate exists only for the run and only one process trusts it.
- The preload, the seed, the browser config and the runner each refuse a non-local database or address and any Vercel machine.
- It is never pointed at Vercel or Neon; the job has `contents: read` and no secrets.

## Known limits (v1)

- The database preload starts only in the one `next start` process the runner launched: its start marker (`CI_DB_PRELOAD_START`) is used up on first load, so a child process that inherits `NODE_OPTIONS` never opens a second bridge (guard test).
- Seeded documents have no stored file, so they show no previews. `/api/blob` and the readiness check use Neon's HTTP driver, which the loopback bridge does not serve.
- Two more places use Neon's HTTP driver and so cannot work here: the readiness panel on `/app/admin` (`lib/readiness.ts`) and the sign-up action (`lib/signup-account.ts`). The route list in U1b-2 leaves them out or notes them.
- The job tests the pull request's own head commit (`github.event.pull_request.head.sha`), not its merge with main, on purpose: it matches the other pull request checks, and a branch is brought up to date with main at its merge turn.
- The stand-in answers only the session check. Signing in through the form, sign-out, password and email flows still run only on the real Neon Auth (live signed-in check after deployment).
- When the Neon Auth SDK is upgraded, the pin test fails first: re-read the SDK's `fetchSessionWithCookie` and `getSession`, update the stand-in, then the pin.

## Run it locally

Needs a built app (`pnpm --filter @visastack/web build`), `openssl`, and a throwaway Postgres on 127.0.0.1 with an empty database:

```bash
createdb -h 127.0.0.1 -U postgres ci_signed_in
DATABASE_URL=postgres://postgres@127.0.0.1:5432/ci_signed_in bash apps/web/ci-signed-in/run.sh
```

If the installed Playwright browser does not match, set `CI_SIGNED_IN_CHROMIUM` to a Chromium binary. Use a fresh database for every run (the seed refuses a used one). Ports 3100 and 45432 must be free (`CI_SIGNED_IN_PORT`, `CI_DB_BRIDGE_PORT` change them).

## Add a page

1. Add or extend a `*.guard.ts` file in `apps/web/ci-signed-in/`.
2. `await signInAs(context, 'traveller' | 'agencyAdmin', baseURL)`, then visit the page.
3. Assert the final address (`new URL(page.url()).pathname`) and text from `seeded()` or `identity()`, never only that something rendered: a sign-in or error page must never pass.
4. Need more made-up records? Add them to `seed.ts` through `@visastack/services` only, and add their ids to `SeededIds`.

Superseded for whole pages by the route guard below (WAL1B-2, 18 Nov 2026): to cover a new signed-in page, add it to `routes.ts` instead of writing a test for it.

## The route guard (WAL1B-2)

`apps/web/ci-signed-in/route-guard.guard.ts` opens every page in `routes.ts` as its made-up person at the three guard sizes of `apps/web/e2e/support/layout-guards.ts` (phone 390, phone 400, desktop 1280). Each page must:

1. answer 200 and stay on its own address (path and query), so a sign-in, not-found or error page never passes;
2. finish loading (the route's loading screen, `output.loading`, is gone) and show its `mustShow` text in the page body: the content column without the workspace toolbar (which shows the signed-in person's name on every page) and without the agency name banner (which a non-member also sees);
3. offer at least one control or link in the page body;
4. need no sideways scroll, and have no control painted over (the shared WAL1 checks).

A page the other made-up person may not open (`deniedTo`: the traveller's profile and case pages for the agency admin, the agency's pages and the shared record for the traveller) is also opened as that person, who must not see the `mustShow` text. That proves the text comes from the page body.

### The lists in routes.ts

| List | Holds | Rule (scripts/ci-signed-in.test.mjs) |
|---|---|---|
| `ROUTES` | 50 pages the guard opens: role, address with `{seededId}` placeholders, body text | Every page file under `apps/web/src/app/app` is in `ROUTES` or `EXCLUDED`, never both, and every listed page has a file. The body text is never the person's own name. |
| `EXCLUDED` | 43 pages it cannot open here, each with its reason: staff pages, one-time invitation links, switched-off features (passkeys, traveller billing, agency collection requests), pages needing records the seed does not make yet (rule pack, receipt, snapshot, group trip) | A reason is required. |
| `KNOWN_FAILING` | Today's real findings by page, size and check (WAL1B-2 records) | The guard requires each listed finding to still fail, so a fix makes it say "remove from KNOWN_FAILING". The list may only shrink: the test pins a ceiling (18 on 18 Nov 2026) that is lowered as findings are fixed, never raised. |

### Add a page

1. New page file under `apps/web/src/app/app`: the list test fails until it is in `ROUTES` or `EXCLUDED`.
2. In `ROUTES`: the role, the address (use `{applicantId}`, `{caseId}`, `{organizationId}`, `{grantId}` or `{documentId}`), body text only that page shows once loaded (read it from the page body, not from a heading the agency banner or toolbar repeats), and `deniedTo` when the other person may not open it.
3. Needs records the seed lacks: add them in `seed.ts` through `@visastack/services` only, with their ids in `SeededIds` and `RouteId`, and move the page from `EXCLUDED` to `ROUTES`.
4. Never add to `KNOWN_FAILING` to make a new page pass: fix the page.

Time: about one minute for the 50 routes on a local machine (2 workers); the GitHub run time is recorded in the WAL1B-2 records.
