# Signed-in guard on the CI machine

Owner goal (17 Nov 2026, board item WAL1b, approved under "I agree with the rest, your recommended options"): "A permanent made-up test traveller and agency login in CI so every upgrade is checked on the real pages, not on fixtures." Made-up data only.

## What it does

Every pull request gets one extra job, "Signed-in guard (made-up people)" (`.github/workflows/pr-signed-in-guard.yml`). It is separate from the three required checks and is not itself required. It:

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
| Runner | `apps/web/ci-signed-in/run.sh` | The whole run, identical on CI and locally. Starts and stops everything. |
| Stand-in sign-in | `apps/web/ci-signed-in/stand-in-auth.mjs` | HTTPS on 127.0.0.1 only. Answers the one call the pinned Neon Auth SDK (`@neondatabase/auth` 0.5.0-beta) makes to learn who owns a session cookie: `GET <base>/get-session`. Knows two made-up people; anything else gets "nobody is signed in". |
| Certificate | made by the stand-in per run | Self-signed, one day, for 127.0.0.1 and localhost. Only that run's `next start` trusts it (`NODE_EXTRA_CA_CERTS`). The app requires an `https://` sign-in address, which is why TLS is used. |
| Session tokens | `tokens.json` in the run folder | Random per run, owner-only file. Never in the repository. |
| Database preload | `apps/web/ci-signed-in/db-preload.cjs` | Loaded into `next start` with `NODE_OPTIONS=--require`. Starts the repository's loopback bridge (`packages/db/src/pg-bridge.ts`) so the production database driver reaches the local Postgres. Refuses any database not on 127.0.0.1 and any Vercel machine before the server starts. |
| People | `apps/web/ci-signed-in/people.json`, `people.ts` | Fixed made-up identities (`@example.test` addresses); `person(role)` adds this run's token, `seeded()` this run's record ids. |
| Seed | `apps/web/ci-signed-in/seed.ts` (Playwright global setup) | Runs the shipped migrations, then creates the traveller (consents, profile, one case, two documents) and the agency (created by its admin, activated by a made-up platform reviewer, shared with by the traveller and accepted by the admin) only through `@visastack/services`. A schema or service change that breaks this shows up at typecheck. |
| Sign-in helper | `apps/web/ci-signed-in/session.ts` | `signInAs(context, role, baseURL)` puts the person's session cookie in the browser (no sign-in form) and refuses any address but this machine. |
| Browser config | `apps/web/playwright.ci-signed-in.config.ts` | Refuses any base URL but localhost; 2 workers. Test files end in `.guard.ts` so the unit test runner never picks them up. |
| Guards | `scripts/ci-signed-in.test.mjs` (in `pnpm run test:node`) | Fails if any app or package file names the guard, another workflow runs it, its workflow gains secrets or a required check's name, the stand-in leaves loopback or answers more, the preload accepts a remote database or Vercel, or the installed SDK changes the call the stand-in answers. |

## Why it cannot reach production

- Nothing under `apps/web/src` or `packages/` imports it (guard test), so none of it is in the deployed bundle, and there is no switch in the app to turn on.
- The stand-in and the bridge listen on 127.0.0.1 only; the certificate exists only for the run and only one process trusts it.
- The preload, the seed, the browser config and the runner each refuse a non-local database or address and any Vercel machine.
- It is never pointed at Vercel or Neon; the job has `contents: read` and no secrets.

## Known limits (v1)

- Seeded documents have no stored file, so they show no previews. `/api/blob` and the readiness check use Neon's HTTP driver, which the loopback bridge does not serve.
- The stand-in answers only the session check. Signing in through the form, sign-out, password and email flows still run only on the real Neon Auth (live signed-in check after deployment).
- When the Neon Auth SDK is upgraded, the pin test fails first: re-read the SDK's `fetchSessionWithCookie` and `getSession`, update the stand-in, then the pin.

## Run it locally

Needs a built app (`pnpm --filter @visastack/web build`), `openssl`, and a throwaway Postgres on 127.0.0.1 with an empty database:

```bash
createdb -h 127.0.0.1 -U postgres ci_signed_in
DATABASE_URL=postgres://postgres@127.0.0.1:5432/ci_signed_in bash apps/web/ci-signed-in/run.sh
```

If the installed Playwright browser does not match, set `CI_SIGNED_IN_CHROMIUM` to a Chromium binary. Use a fresh database for every run.

## Add a page

1. Add or extend a `*.guard.ts` file in `apps/web/ci-signed-in/`.
2. `await signInAs(context, 'traveller' | 'agencyAdmin', baseURL)`, then visit the page.
3. Assert the final address (`new URL(page.url()).pathname`) and text from `seeded()` or `identity()`, never only that something rendered: a sign-in or error page must never pass.
4. Need more made-up records? Add them to `seed.ts` through `@visastack/services` only, and add their ids to `SeededIds`.

The full route list and the layout guard over every route are the next step (U1b-2).
