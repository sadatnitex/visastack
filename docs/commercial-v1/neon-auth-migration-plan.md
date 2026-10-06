# Plan: sign-in, sign-up and email through Neon

Written 2026-10-06 at the owner's request ("email and sign-in / sign-up authentication should all be done by Neon"). Status: PLAN ONLY, nothing built or switched. Reason: this replaces the sign-in system for every user and every staff action, it cannot be tested live from the build sandbox (the Neon documentation host and any Neon Auth project are unreachable from here), and parts of it cannot be undone once real accounts exist. The owner's decisions are listed at the end.

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
