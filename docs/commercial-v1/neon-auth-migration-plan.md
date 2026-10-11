# Plan: sign-in, sign-up and email through Neon

> Historical setup and incident guidance. Provider, domain, migration and email-linking instructions below are superseded where they conflict with the latest approved decisions. Start with [current operating guidance](../operations/current-platform.md). Historical evidence and original acceptance targets are retained.

Written 2026-10-06 at the owner's request ("email and sign-in / sign-up authentication should all be done by Neon"). Status: PHASE 1 BUILT (see 'Phase 1 result' at the end); phases 2 to 4 not started. Production is unchanged and still uses WorkOS. Reason: this replaces the sign-in system for every user and every staff action, it cannot be tested live from the build sandbox (the Neon documentation host and any Neon Auth project are unreachable from here), and parts of it cannot be undone once real accounts exist. The owner's decisions are listed at the end.

## What Neon offers (from search results, not read from Neon's own pages, which the sandbox cannot open)

| Need | What Neon provides | Limit that matters |
| --- | --- | --- |
| Sign-in and sign-up | Neon Auth, a managed service built on Better Auth, with a Next.js package (`@neondatabase/auth`). Users and sessions live in the same Neon database | Free up to 60,000 monthly active users |
| Auth emails (verify address, reset password) | Neon sends them through a shared sender by default | **2 emails an hour for the whole project** until a custom email account (SMTP) is connected. Verification by link (not code) also needs the custom account |
| Application emails (case invitations, expiry reminders, alerts) | **Neon has no email-sending service.** It only lets Neon Auth use an SMTP account you supply | Needs any SMTP provider, even a free one |
| Staff multi-factor sign-in, step-up | Better Auth has a two-factor feature; whether the managed Neon version exposes it was not confirmed | Must be confirmed before staff move over |

So "email by Neon" can mean: one email account connected to Neon Auth (for auth emails) and the same account used by the app for its own emails. Neon itself does not send them.

A known open issue in the Neon package (as reported on its public tracker): a renewed session cookie can be dropped, signing active users out about 7 days after sign-in. Re-test before launch.

## Where the app depends on WorkOS today

About a dozen places: the request filter (`middleware.ts`), the callback route, the session bridge (`lib/session.ts`), step-up checks (`lib/step-up.ts`, `api/session-reauth`), the 7 day session limit (`lib/session-age.ts`), sign-out buttons, the pilot-access screen, and the account record, which is matched by a WorkOS user id stored in the database (`accounts.workos_user_id`, also copied into some audit snapshots). The sign-in system already sits behind a provider switch (`IDENTITY_PROVIDER`) and an identity port, which is the structure to keep.

## Approach (three points)

1. **Add Neon Auth as a second provider behind the same switch.** WorkOS stays the default and stays working until Neon Auth passes a staging check. Switching is one setting, and switching back is one setting. Structure unchanged.
2. **Link accounts by a new provider id plus verified email only.** A new nullable column pair for provider and provider user id (a database change, run only on the owner's explicit go-ahead for that run). Existing pilot accounts link on first Neon sign-in only when the email is verified; an unverified address never links, which blocks takeover of an existing account by someone who merely registers its address.
3. **Rebuild step-up and the session limit on Neon's session data**, with the same rules: a recent sign-in is required for sensitive actions, forced by a fresh password check, never by a flag the browser can send; staff pages require a second factor once Neon's two-factor support is confirmed. Every rule keeps its existing test, rewritten for the new provider, and each new guard is proved by breaking it once.

## Phases

| Phase | Content | Needs from owner |
| --- | --- | --- |
| 1 | Neon identity port, provider switch, request filter, callback and sign-out for Neon, with tests against a fake Neon. No database change. WorkOS unchanged | Nothing |
| 2 | Account-link column pair, migration (owner go-ahead for the run), linking rules, audit snapshot compatibility | Go-ahead for the migration run |
| 3 | Step-up, session limit, staff second factor on Neon | Neon Auth enabled on the Neon project; the two settings below put into the hosting environment |
| 4 | Staging check with two test accounts, then the owner flips the switch in production | Two test accounts; the flip itself |

Settings needed from the owner in phase 3 (names only, never paste values into chat): `NEON_AUTH_BASE_URL` (shown in the Neon console once Auth is enabled) and `NEON_AUTH_COOKIE_SECRET` (a random string of at least 32 characters you generate).

## Risks stated plainly

- Phase 2 and the production flip are the hard-to-reverse steps. Phases 1 and 3 are reversible.
- Until a custom email account is connected, Neon limits auth emails to 2 an hour, which blocks real sign-ups. Connect one before any public sign-up.
- The acceptance tests A01 (identity), A02 (revocation) and A27 (privilege) must be re-run on the new provider; they are not carried over from WorkOS.
- Moving off WorkOS removes its separate hosted staff multi-factor control; the replacement must be proved, not assumed.

## Owner decisions needed

1. Go for phase 1 now (code only, no effect on production).
2. Confirm the defaults above: link by verified email only; step-up by fresh password check; staff second factor required once confirmed.
3. Choose the SMTP account (a free tier works at first) so both Neon Auth and app emails use it.

## Phase 1 result (2026-10-06)

Built, all behind `IDENTITY_PROVIDER=neon_auth` (default stays WorkOS; unset or any other value keeps WorkOS):

- Neon identity port with the same contract as the WorkOS one (verified flag passed through, missing flag counts as not verified).
- Request filter: with Neon selected, `/app/*` and `/pilot-access-denied` require a Neon session and unsigned-in visitors go to `/auth/sign-in`; the landing, status and trust pages and the two auth pages stay public. With WorkOS selected, the filter is exactly as before.
- `/auth/sign-in` and `/auth/sign-up` pages (plain forms that work without scripts, fixed plain-language messages, one generic failure message so the forms cannot reveal who has an account). Both are 404 under WorkOS.
- `/api/auth/*` hands requests to Neon Auth; under WorkOS every path is a plain 404.
- Provider-aware sign-out on the three sign-out buttons.
- `withSession` refuses to run under Neon until phase 2 (account linking): a premature switch fails closed instead of matching or creating accounts from an identity it cannot yet map safely.
- Settings validation: base address must be https, cookie secret at least 32 characters, secret never printed.

Facts found while building that change the risk picture (also in `known-issues.md` chunk 50):

1. **The Neon login package is a beta** (`@neondatabase/auth` 0.5.0-beta, pinned exactly). It also pulls in `better-auth`, a Supabase auth client and its UI package.
2. **Its declared requirement is Next 16 or later**; its own guide says Next 15 and later. This app is on Next 15.5. The package resolves to the app's single Next copy (no second copy was installed) and its tests here pass, but a live check on a real Neon Auth project is still owed.
3. A reported session-cookie renewal bug (sign-out after about 7 days) should be re-tested.

Not done, owed: a live sign-in against a real Neon Auth project (none exists, and the sandbox cannot reach Neon); email verification and password reset behaviour; the staff second factor; every row of phases 2 to 4.

## Phase 2 and recovery result (2026-10-09)

Built on the owner's instruction to open a public beta on Neon Auth and Resend (setup and deferred register: `docs/operations/public-beta-sign-in.md`). Still behind `IDENTITY_PROVIDER=neon_auth`; WorkOS remains the default.

- Account link: new nullable unique column `accounts.neon_user_id` (migration 0084, additive, not yet run anywhere). `provisionNeonAccount` binds by immutable Neon id, links an existing account only for a CONFIRMED address, refuses and audits a different Neon id for a bound address, never creates or links for an unconfirmed address.
- `withSession` now runs under Neon: identity from the server session, unconfirmed address sent to `/auth/verify-email` before any database work.
- Pages and actions: sign-in, sign-up, confirm email (resend), forgot password, reset password, password re-check. Fixed messages, same answer for known and unknown addresses, safe same-site return addresses, per-address and per-source limits.
- Session limit (7 days, 12 hours for staff) and step-up (5 minutes) rebuilt on the Neon session creation time; re-checking means typing the password again, which makes a new session.
- Public beta switch `PUBLIC_BETA_OPEN=true` skips the invitation list, only with Neon sign-in. It does not enable real-applicant data, payments or commercial claims.
- Capability and readiness checks now follow the selected sign-in system.
- Not done: any live check, staff second factor, the commercial readiness check on Neon (see register D1, D4, D8).


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
