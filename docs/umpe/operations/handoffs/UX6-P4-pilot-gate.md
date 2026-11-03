# UX6 package 4: the pilot gate and people with no account

Status: investigated only. Nothing was implemented, on purpose (reasons below). This needs an owner decision before the companions switch goes on, and only if sign-up is closed.

## The question

A person with no VisaStack account follows a companion invitation link. In controlled pilot mode, can they be stopped before they reach the accept page?

## What was found (read from the code, not tried against the live site)

| Step | What happens | Where |
|---|---|---|
| 1. Link opened, not signed in | The site sends them to sign-in and keeps the whole link (token included) in the return address. | `apps/web/src/middleware.ts` (`/auth/sign-in?next=...`), `lib/identity-selection.ts` |
| 2. Sign-in page | Offers Create an Account and keeps the same return address. | `app/auth/sign-in/page.tsx` |
| 3. Sign-up | **Not** checked against the pilot list. Anyone can create the sign-in identity and confirm the email. The only visible difference is the words "Access is by invitation" when public sign-up is closed. | `app/auth/sign-up/page.tsx`, `app/auth/actions.ts` (`signUpAction`) |
| 4. First page under `/app` | `withSession` asks `checkPilotAccess` BEFORE it makes the VisaStack account. If the identity has no account, is not on `PILOT_ALLOWLIST_EMAILS` and has no live pilot invitation, the person is sent to "This pilot is invite-only". | `lib/session.ts` (`resolveSignedInAccount`), `lib/pilot-access.ts`, `packages/services/src/pilot-access.ts` |
| 5. The bypass | The check is skipped entirely in development, and whenever the public beta is open (`PUBLIC_BETA_OPEN=true` with Neon sign-in fully configured). | `lib/pilot-access.ts`, `lib/public-beta.ts` |

So the gate bites at step 4, after sign-up, and the companion accept page is behind it because it lives under `/app`. The pilot check reads only the pilot invitation table (and the allowlist and existing accounts). It does not know about companion invitations. The same is true today of sharing, client and contributor invitations: none of them lets a new person past the gate.

## Is it a problem today?

Probably not in production as it stands. The production readiness report of 1 Nov 2026 (in `docs/operations/current-platform.md`) lists `publicSignup` as available, which is only true when `PUBLIC_BETA_OPEN` is on, and the bypass in step 5 follows from the same setting. This was not re-checked live for this note (no production access from here). It becomes a real stop only if the owner closes sign-up again (removes `PUBLIC_BETA_OPEN`): then a friend with no account who follows a companion link signs up, confirms the email, and lands on "This pilot is invite-only".

## Options

1. **Do nothing (recommended while public sign-up stays open).** No change to the gate. If sign-up is closed later and a friend needs in, the owner adds the address under Admin, Access (pilot invitation) or `PILOT_ALLOWLIST_EMAILS`. Nothing about the organiser's view changes; the organiser never learns whether an address has an account either way.
2. **Let a live companion invitation count as a pilot invitation for that one address.** The smallest safe version: the gate would allow account creation for an address only when an unexpired companion invitation holds exactly that address (lower-cased, compared in the database) AND the person holds that invitation's token (the check has the token in hand, so a typed address alone never counts). It would never apply to any other path, never mark anything as used until the person actually joins, and never be offered when the address already has an account (nothing then differs for the organiser).
3. **Let any organiser admit anyone** by address alone (no token). Rejected: it lets any account holder open the pilot to anybody just by adding their email to a trip. That is a decision about who may invite into the pilot, and it widens sign-up for every path.

## Why option 2 was not built here

- The gate runs inside `withSession` on every signed-in page, before any page code. At that point the code knows the cookie, not the link. Matching "by token" needs the link's token carried into `withSession` (a header set by the middleware, or a one-time cookie set when the accept page is first requested). That touches `lib/session.ts`, the middleware and the content security policy file: security core code, and not a small or local change.
- Without the token (matching the address alone) it becomes option 3 for a window of 7 days after every invitation, which is a real widening of sign-up.
- It also needs a rule for what a "used" companion invitation does to the gate, a test for each bad case (expired, declined, removed, wrong address, address already has an account), and a decision on what happens when the person signs up but never joins.
- The owner decision about whether a trip invitation should open a closed pilot has not been given ("package4-go" did not answer it).

## What to decide

If the owner wants option 2, it is its own package: carry the token into the gate (one place), add `companionInvitationAdmits(db, { email, token })` next to `checkPilotAccess`, call it only when the normal check says no, and add tests that prove each bad case still lands on "This pilot is invite-only". Nothing in packages 1 to 4 depends on it.

## Left as is

The gate, the sign-up page, `withSession`, the pilot invitation table and the middleware are untouched by this package.
