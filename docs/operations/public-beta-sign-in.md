# Public beta: sign-in, sign-up, email and recovery (Neon Auth and Resend)

Written 2026-10-09 at the owner's request: open VisaStack to the public for a while, non-commercial, with all features, using Neon Auth for accounts and Resend for email. This page is the setup runbook and the register of everything deliberately left for later. Nothing here approves a commercial launch.

## What the public beta is, and is not

| Is | Is not |
| --- | --- |
| Anyone with a confirmed email address can create an account and use every feature that is switched on | A commercial launch. Payments, commercial claims and the "real applicant data" capability stay off |
| Sign-in, sign-up, email confirmation, password recovery and password re-check, all on Neon Auth, emails through Resend | A replacement of the 18-row release gate in `docs/commercial-v1/release-gate.md`. That gate still applies to a commercial launch and none of its rows moved |
| Reversible with one setting: remove `PUBLIC_BETA_OPEN` and sign-up is invite-only again; set `IDENTITY_PROVIDER` back to `workos` and the old sign-in returns | A guarantee for real passports and identity papers. The scanner is not connected, so uploads that need it stay refused, and no independent backup of document files exists (see the register below) |

## How it works

1. A person creates an account at `/auth/sign-up`. Neon Auth emails a confirmation link (sent through Resend).
2. They cannot sign in, and the app creates no account, until the address is confirmed. An unconfirmed address that tries to sign in is sent to `/auth/verify-email`, where the link can be sent again.
3. First confirmed sign-in creates the local account tied to the Neon user id. An existing pilot account with the same address is linked only because the address is confirmed; an unconfirmed address never links, so nobody can take over an account by registering its address.
4. `/auth/forgot-password` emails a one-time link to `/auth/reset-password`. The answer is the same whether or not the address has an account.
5. Sessions end after 7 days (12 hours for staff). A sensitive step asks for the password again at `/auth/reauth` (5 minute window).
6. Sign-in, sign-up and email sending are limited per address and per network source.

## Owner setup, in this order (names only; never paste values into chat)

| # | Where | Do | Result |
| --- | --- | --- | --- |
| 1 | Resend | Add the sending domain `obsidianglobal.studio`. Add the records Resend shows (SPF and DKIM) at the place that holds the domain's DNS. Wait until it says verified. Create one API key | Mail can be sent from that domain. Free tier: 100 emails a day, 3,000 a month, so watch it during the beta |
| 2 | Neon console, the project's Auth page | Enable Auth. Copy the Auth address (`NEON_AUTH_BASE_URL`) | Accounts exist in your own database |
| 3 | Neon console, Auth email settings | Use a custom email account (SMTP) with Resend's SMTP details: host `smtp.resend.com`, port 465, user `resend`, password = the API key. Sender: an address on the verified domain, for example `VisaStack <noreply@obsidianglobal.studio>` | Removes the 2 emails an hour project limit |
| 4 | Neon console, Auth settings | Require email confirmation, by link. Add `https://visastack-five.vercel.app` and `https://visastack.obsidianglobal.studio` as allowed sites. Ask that signing out everywhere happens when a password is reset, if the setting exists | Unconfirmed addresses cannot sign in; links are allowed to return to the app |
| 5 | Hosting settings (Vercel), production | Set `IDENTITY_PROVIDER=neon_auth`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (any random string of 32 or more characters you generate), `PUBLIC_BETA_OPEN=true`. For the app's own emails also `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_WEBHOOK_SECRET` | The app uses Neon sign-in and opens sign-up |
| 6 | GitHub Actions | Run "DB Migrate (manual)" from `main`, type `migrate`. This adds one empty column (`accounts.neon_user_id`) and nothing else. It must run right after the code is merged, because the new code reads that column | Required before the switch. Ask for the go-ahead for this specific run |
| 7 | You | Create two test accounts (one new address, one address that already has a pilot account), confirm the email, sign in, sign out, run password recovery, sign in with the new password | The live check that no one has been able to run from the build environment |

Existing pilot people have WorkOS passwords that do not move. After the switch they use "Forgot your password?" once with the same address, and their account is linked automatically.

## Register of what is deferred (nothing here is done unless it says so)

| # | Item | Why it matters | State |
| --- | --- | --- | --- |
| D1 | Live test against a real Neon Auth project, including the real emails | Everything was tested against a fake Neon in this environment only. Step 7 above is the first live proof | NOT DONE |
| D2 | Neon login package is a beta (`@neondatabase/auth` 0.5.0-beta) and declares Next 16 while the app is on Next 15.5 | A package update can change behaviour. Pinned exactly | OPEN |
| D3 | Reported bug: renewed session cookie dropped, signing people out about 7 days in | Would show as people being signed out early | Re-test during the beta |
| D4 | Staff second factor (IAM-01 / G16) | Not enforced before and not enforced now. Not confirmed available on managed Neon Auth | OPEN |
| D5 | Terms and privacy notice with consent at sign-up (G06) | A public beta collects personal data. There is no consent step and no lawyer-approved wording yet | OWNER DECISION NEEDED before wide promotion |
| D6 | Bot protection (a challenge on sign-up) | Only rate limits exist. A flood of fake sign-ups could use up the Resend daily allowance and block real confirmation emails | OPEN |
| D7 | Real documents: scanner (G02), restore drill (G07), independent review (G08), key escrow (G09), independent file backup (G10), named people (G11, G12) | All 18 gate rows still stand. People should be told to use sample information until these exist | OPEN, owner |
| D8 | Commercial readiness check still looks for WorkOS settings | Commercial mode on Neon sign-in will report not ready. Beta mode is unaffected | OPEN, fix before any commercial switch |
| D9 | Acceptance tests A01, A02, A27 on the new provider | Written for WorkOS. Not re-run live | NOT DONE |
| D10 | Change of email address, sign in with Google or other accounts, password strength beyond 8 characters, breach checks | Not built | DEFERRED |
| D11 | Staff screens still show the WorkOS id column for the access list; platform-role history keeps no Neon id snapshot | Cosmetic and audit detail for Neon accounts | DEFERRED |
| D12 | Idle timeout for staff, hourly reminder sweeps, Bangla and translations | Unchanged from earlier records | DEFERRED |
| D13 | Isolated staging environment | Does not exist; the first live check happens in production | OPEN |

## Preview URL routing and recovery feedback (2026-10-11)

The designated preview address is registered with Vercel as a verified project domain bound to `public-beta/r2-encrypted-recovery`. Production domains remain unbound to preview branches. A release must verify that the branch address resolves to its exact READY deployment. Preview absolute links and CSP select `VERCEL_BRANCH_URL`, then `VERCEL_URL`; production uses its configured canonical custom domain. Do not paste a deployment SHA into `gitSource.ref` when rebuilding a preview: branch-scoped environment values require the actual branch ref.

Password recovery replaces the initial form with a check-email confirmation after a request. A separate expandable resend form is available, using the existing server-side limits of three sends per address per hour and ten per network address per hour. The response does not disclose whether an account exists. Service errors show a retry message; no delivery success is inferred from a provider outage. A password reset does not transfer a WorkOS-bound account to Neon Auth or grant a platform role.
