# Google sign-in

Status on 17 Nov 2026: built and switched off. Until the switch below is turned on, nobody sees a change: there is no "Continue with Google" button, and the address `/auth/google` sends a visitor to the ordinary sign-in form.

## What was built

- A "Continue with Google" link on the sign-in and sign-up pages, and on the "Confirm it is you" page for a person who has no password (a Google sign-in makes a new session, which is what that page asks for).
- `apps/web/src/app/auth/google/route.ts`: the start. It asks Neon Auth for Google's sign-in address and sends the browser there. It is a link, not a form, because the page's content policy would block a form from sending the browser on to Google. Because a link is a plain GET it does its own checks: the click must come from one of our own pages, starts are limited per network address (before anything is sent to Neon Auth), the provider and return addresses are fixed in code, the browser is sent only to Google's own address, a stalled call gives up after eight seconds, and a failure at Neon Auth, a timeout or an unexpected error is logged through the app's redacting error reporter (refused starts are not logged).
- `apps/web/src/app/auth/social-return/page.tsx`: where Google sends the person back. It is a page of its own so a Google return never says "email confirmed". A visitor with no session is sent to the sign-in form with the Google message.
- Return addresses use the host the person is on (the main address or the fallback address), because the sign-in cookies Neon Auth sets belong to that host only.
- While someone is signed in, only a person with no password can start Google (it is how they pass the "Confirm it is you" check). Someone with a password who clicks the button is sent on to where they were headed, because otherwise one tap on a device that is still signed in to Google would replace the password check.
- Nothing about who may get in was changed. After Google, every request goes through the same checks as an email sign-in: the invitation check, the confirmed-email rule, and the account binding that refuses an email already tied to another identity.

## Owner decision on record

17 Nov 2026, owner: "yes, go with option A. and adding linkedin based login later, we did it for older version, also have the visastack app, we should use that". Option A: Google sign-in now; LinkedIn is not a sign-in option because Neon Auth lists only Google, GitHub, Microsoft, Vercel, Apple and Discord. LinkedIn is planned as a "Connect LinkedIn" profile import inside the product, using the existing VisaStack LinkedIn app, and later as a sign-in if Neon Auth adds it. Neither LinkedIn piece is built. This puts Google ahead of the order in `docs/roadmap/GROWTH-PROGRAMME-2026-10-27.md` (G9: email code first); the email one-time code is still not built.

## Before switching it on (every item must be true)

1. **The owner decides how agreement to the terms is recorded for Google sign-ups (D5 in `docs/operations/public-beta-sign-in.md`).** The email form requires a tick and records a versioned acknowledgement before the account exists (`docs/public-beta/SIGNUP-SAFEGUARDS.md`). That record holds a random form number, not an account or an email, so a Google sign-up cannot be matched to one without new storage. Today the Google button only shows a line saying that continuing means agreeing. Until the owner decides, Google must stay off.
2. **Google is set up in Neon Auth for the production project** (owner steps, no secret is ever pasted into chat or into the repository):
   - In Google Cloud Console, make a project named VisaStack, set up the consent screen with the VisaStack name, logo and the privacy and terms links, publish it to production, and create a "Web application" client.
   - Register one redirect address with Google: the Neon Auth address followed by `/callback/google` (the address is `NEON_AUTH_BASE_URL` in the Neon console for the production branch).
   - In Neon Auth, add Google with that client's ID and secret, and make sure both site addresses (the main address and the fallback address) are trusted domains, as exact addresses. Never a wildcard such as `*.vercel.app`: a wildcard would let someone else's site receive the one-time sign-in code.
   - Add Google in Neon Auth as late as possible, right before step 4. Once Google exists there, Neon Auth accepts Google sign-in starts from any program that names a trusted address, whatever this site's switch says; the switch only hides the button and this site's own start route. Those direct starts still meet the invitation check, but they skip the own-page check, this site's limit and any record of agreement to the terms.
3. **The live checks below have passed** on the main address and on the fallback address. None has been run yet: this change was built and tested without a real Google client.
4. Then set `GOOGLE_SIGN_IN_ENABLED=true` in Vercel Production (last), and redeploy.

## Live checks that have not been done

- A full sign-in with a test Google account, on both addresses, ending signed in at the page the person was headed for.
- That Neon Auth accepts a start made from the server (the click carries no `Origin` header, so Neon Auth is told the origin from the page the click came from) and sets the sign-in cookie it needs on this site.
- That a Google sign-in for an address that has an unconfirmed email sign-up does not give the person who made that sign-up access (pre-registration takeover). Better Auth refuses this by default; whether the hosted Neon Auth does is not visible from the repository.
- That signing in with Google again on the "Confirm it is you" page really makes a fresh session (the app measures recency from the session's creation time).
- That Neon Auth's own limits do not count every visitor against this server's single address (Neon Auth sees only that address). The app-side limit is `AUTH_SIGN_IN_IP`, shared with password attempts from the same address.
- An uninvited Google account lands on the "not invited" page, and an invited one lands in the product.

## Known limits

- Agreement to the terms is a line of text, not a recorded acknowledgement (see item 1 above).
- A Google address spelled differently from the one a person used for an invitation (for example `john.doe@gmail.com` and `johndoe@gmail.com`) is a different address to Neon Auth. In the pilot that person sees "not invited".
- Neon Auth sees only this server's address, so any limit Neon Auth applies to sign-in starts is counted against everyone together. A script that stays under this site's own limits from several addresses could use it up for everyone. Not measured.
- A person who only ever signed in with Google has no password. If Google sign-in is later switched off they cannot sign in, except by asking for a password reset (not tried). Switch it off only after telling people.
- A start that Google or the person abandons leaves a short-lived sign-in cookie in the browser. While it exists, each page that browser opens makes one extra Neon Auth lookup. It affects speed only.
- Sign-ins by Google are not yet counted by method. The planned event name `SIGN_IN_METHOD_USED` (G9) is not added.
- The button text and the notice under it are English only for now (marked as English on a Bengali page).
- On the sign-up page the Google button sits above the three email steps (create, confirm your email, sign in), which do not describe a Google sign-up. The page wording is for the owner to settle together with the consent decision.
- A browser or extension that strips the page address it came from (the Referer) cannot start Google sign-in; the person is told to use email and password.

## Switching it off

Remove `GOOGLE_SIGN_IN_ENABLED` or set it to anything other than `true`, and redeploy. The button disappears and `/auth/google` shows the sign-in form with a plain message. Existing sessions are not affected. To close Google completely, also remove Google in Neon Auth (see the note under step 2: the switch alone does not stop a program that talks to Neon Auth directly).
