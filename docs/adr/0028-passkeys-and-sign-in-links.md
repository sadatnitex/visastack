# ADR-0028: Passkeys that confirm it is you, and sign-in links by email

- **Status:** Accepted, 17 November 2026
- **Date:** 2026-11-17
- **Deciders:** Owner (choice "A + B (Recommended)", 17 November 2026, relayed by Guardian 3)
- **Unit:** Q8 (picture-first upgrade, web and installed app features)
- **Amends:** none. Adds to the step-up rule in `apps/web/src/lib/step-up.ts` for travellers only.

## Context

The owner asked for passkey sign-in for travellers on the web and the installed app (17 November 2026, exact words: "use all that's possible via web & pwa(maximum of all that's possible in native) ... and dont break any existing feature, rather build the upgrade over them").

Neon Auth is the only sign-in system. It runs Better Auth for us; we cannot add Better Auth plugins. Checked on 17 November 2026:

- The installed `@neondatabase/auth` 0.5.0-beta fixes its client plugins (jwt, admin, organization, emailOTP, magicLink, phoneNumber, anonymousToken); there is no passkey plugin.
- Neon's plugin list (https://neon.com/docs/auth/guides/plugins, updated 30 October 2026) and roadmap (https://neon.com/docs/auth/roadmap, updated 9 November 2026) do not include passkeys.
- The production Neon Auth settings (read only) show organization and magic link on, phone number off, and no passkey setting.

So a passkey cannot sign anyone in today without creating sign-ins ourselves, which would mean admin impersonation or running our own copy of Better Auth. Both were rejected.

## Decision

A. **A passkey confirms it is you inside an existing sign-in.** It never signs anyone in.
- Before a sensitive step, a traveller whose password was typed more than five minutes ago may use Face ID, a fingerprint or the screen lock instead of typing the password again.
- The use is recorded against a hash of the current Neon session id. A new sign-in has a new hash, so a confirmation never carries over to it.
- Staff (any platform role or organization membership) are not changed: password plus authenticator code, as before.
- The absolute session limits (7 days for travellers, 12 hours for staff) ignore passkeys entirely.
- Adding or removing a passkey needs the password typed in the last five minutes.
- WebAuthn with user verification required. The challenge is kept in a signed, two-minute, httpOnly cookie, one per purpose, bound to account and sign-in, and cleared when read. An answer to another challenge is "try again", never a failed passkey. The database refuses the same challenge twice, any challenge given out before the passkey's last use, and a signature counter that goes backwards.
- Confirmations have their own per-account limit (`PASSKEY_CONFIRM`), apart from the password limits. If the limit cannot be read the attempt goes on: an answer is a signature from the person's own device, which cannot be guessed, and every other check still runs.
- Off unless `PASSKEYS=on`. One new table, `passkey_credentials` (migration 0137, re-runnable). Until the owner runs it, every read reports "not available" and step-up asks for the password as before.

B. **Sign in with a link by email**, using the magic link sign-in Neon Auth already offers.
- Off unless `SIGN_IN_LINKS=on`.
- Every valid address takes the same steps and gets the same answer, so the form never shows who has an account. The email limit is checked first and refuses when it cannot be read.
- The link returns to `/auth/link-return`. A new person goes through the same agreement and invitation checks as a new Google sign-in.
- Only the browser that asked can finish: asking sets a signed, 15-minute, httpOnly "link pending" cookie for every valid address, and the landing ends any link sign-in in a browser without one. A link someone else asked for (for their own account) therefore cannot sign this browser in, whatever Neon Auth does with its own check cookie, which cannot be inspected from here.
- A link never makes a staff sign-in: the landing ends it and asks for the password. The confirm-it-is-you page offers the link to travellers only.
- An email link counts as a fresh sign-in for traveller step-up, like a password. Email can already reset a password, so this gives no new power. Staff never get a link sign-in.

## Consequences

- Travellers get faster sensitive steps on phones and laptops. Nothing changes for anyone until the owner switches each part on.
- Passkeys belong to the production host (`vs.obsidianglobal.studio`). They do not work on the `vercel.app` fallback address.
- An email link must be opened in the same browser that asked for it: Neon Auth's sign-in hand-over needs a cookie set in that browser. Anywhere else, the sign-in page explains this.
- Owner actions, in this order: "migrate 0137"; set `PASSKEYS=on` in Vercel Production; keep Neon's magic link sign-in on only together with `SIGN_IN_LINKS=on` (Neon's own public address could otherwise send links without our limits); optionally set Neon magic link "disable sign up" to on (our checks already cover new identities); send the request below to Neon.

## Rollback

Switch either part off (a redeploy applies it), or revert the change. The table is additive and harmless if left in place. Dropping it needs its own owner-approved migration.

## Request to Neon (draft for the owner to send; not sent)

> Hello Neon team. We run Managed Better Auth (SDK 0.5.0-beta, Next.js) for VisaStack, an invite-only visa document service. Our travellers mostly use phones, and we would like passkey sign-in (the Better Auth passkey plugin) as a supported plugin, configurable per branch like magic link, with passkey events in webhooks. Today we let people confirm sensitive steps with a passkey inside an existing sign-in, but true password-free sign-in needs the plugin on your side. Is passkey support planned, and is there an early access programme we could join? Thank you.
