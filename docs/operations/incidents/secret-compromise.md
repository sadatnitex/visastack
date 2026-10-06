# A secret or key leaks, or may have leaked

Use this when a credential may be in the wrong hands: pasted in a chat, email or document,
committed to the repository (even if removed later), printed in a build or runtime log, found in
the browser bundle, shown on a shared screen, on a lost device, or held by someone who has left.
Also use it for any suspected takeover of a Vercel, GitHub, Neon, WorkOS, Resend, AI-provider or
domain account. Read [README.md](./README.md) first.

**The rule.** Deleting a leaked secret from where it was seen does not un-leak it. Assume it was
copied. The fix is to replace the secret and cancel the old one, then look for signs it was used.

## What each secret protects

Names are the environment variables set in the Vercel project (`.env.example` lists them; values
are never written in this repository). "Rotate" means: create a new value, put it in the
place it lives, redeploy, cancel the old value.

| Secret | What an attacker could do | Where it lives | Rotation and what it costs |
|---|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Read and change every record, including the audit trail (the owner role can drop the rules that protect it) | Vercel environment; GitHub Actions secrets for the migration workflow | Neon console: reset the password of the database role. Update the Vercel variables and the GitHub secrets, redeploy. The app is down for signed-in pages between the reset and the redeploy; do the two close together |
| `KMS_LOCAL_MASTER_KEY_BASE64` | With a copy of the database, decrypt every protected field (passport numbers, income) and every stored AI key | Vercel environment | **There is no rotation tool.** Do not change the value: existing protected data would become unreadable. See "The master key" below |
| `BLOB_READ_WRITE_TOKEN` | Read, overwrite and delete every stored document | Vercel environment | Vercel dashboard, Storage, the Blob store: regenerate the token, update the variable, redeploy. In-flight uploads fail until the redeploy finishes |
| `BLOB_SIGNING_SECRET` | Forge links that open a stored document for a few minutes (a link also needs a valid grant check, but treat it as serious) | Vercel environment | Replace with a new random value, redeploy. Open links stop working, which is fine because they are short-lived |
| `WORKOS_API_KEY` | Act as the app towards WorkOS: list users, read sessions, change sign-in settings | Vercel environment; WorkOS dashboard issues it | WorkOS dashboard: create a new key, update the variable, redeploy, delete the old key. Sign-in fails between the redeploy and the old key's removal only if you delete first, so replace first |
| `WORKOS_COOKIE_PASSWORD` | Forge or read session cookies | Vercel environment | Replace with a new random value of at least 32 characters, redeploy. **Everyone is signed out** |
| `STEP_UP_SIGNING_SECRET` | Forge the five-minute "I just re-signed-in" tokens that guard bulk export | Vercel environment | Replace, redeploy. Only step-ups in progress fail |
| `CRON_SECRET` | Call the scheduled-job addresses by hand, including sweeps that delete data once the retention switches are on | Vercel environment | Replace with a new random value, redeploy (Vercel signs its own scheduled calls with whatever the variable holds). Then check the logs for job addresses hit by anything but Vercel |
| `RESEND_API_KEY` | Send email as the product's domain (phishing with the product's name) | Vercel environment; Resend dashboard | Resend dashboard: create a new key, update the variable, redeploy, delete the old key. Cancel the old key at once if abuse is suspected, even before the new one is live |
| `RESEND_WEBHOOK_SECRET` | Forge delivery and bounce events (hides real failures, or fakes them) | Vercel environment; Resend dashboard | Resend dashboard: new signing secret; update the variable; redeploy |
| `OPENAI_API_KEY` and any key entered on the AI settings page | Spend money and read what is sent to the provider | The variable is in Vercel; keys entered on the AI settings page are stored encrypted in the database and shown only as their last four characters | Cancel the key in the provider's own console first (the app can only forget it, not cancel it), then use "Revoke key" on `/app/admin/ai-settings`, then create the replacement |
| Vercel, GitHub, Neon, WorkOS, Resend, AI-provider and domain-registrar logins | Everything above | Each provider | Change the password, end other sessions, check and re-enrol MFA, review members and tokens, then rotate everything the account could read |
| `ADMIN_EMAILS`, `PILOT_ALLOWLIST_EMAILS` | Not secrets, but they decide who can reach the admin area or the pilot | Vercel environment | Remove addresses that should no longer have access, redeploy |

Not secrets: `WORKOS_CLIENT_ID`, `NEXT_PUBLIC_*`, `SENTRY_DSN`, `RESEND_FROM_ADDRESS`, the provider
selectors. A leaked public value needs no rotation.

## Contain (first 15 minutes)

1. **Declare** the incident and open the log.
2. **Find out which secret and how far it went.** Where was it seen, by whom, for how long, and is
   the place public or private?
3. **Cancel it if cancelling is safe and fast.** For a key to an outside service (email, AI, blob
   token) cancel the old value at the provider first. For something the app needs to run (database,
   cookie password, signing secrets) replace first, so the app stays up.
4. **Rotate** using the table. Change the Vercel variable for the **Production** environment, and
   for Preview if the same value was used there, then redeploy production from the Vercel dashboard.
   A changed variable does nothing until a new deployment is made.
5. **Update the GitHub Actions secrets** that hold the same value (the migration workflow uses the
   database connection strings).
6. **If the secret was committed,** also remove it from the code and open a pull request for that.
   Rewriting git history does not protect anyone; the rotation does.

## Preserve evidence

Follow the README list **before** rotating where you can. For this scenario also keep:

- Where and when the secret was exposed (the message, the commit, the log line), with a screenshot
  or a hash of the file.
- The provider-side record of use, as far as each provider keeps one: Neon monitoring (connections
  and activity) and any database logs the plan keeps, the Resend sent-email log and API request
  log, the AI provider's usage page, the Vercel Blob store's contents and usage graphs, the WorkOS
  dashboard logs. Export the window from the first possible exposure to now, and write down where
  a provider keeps nothing, because that is a limit on what you can conclude.
- The Vercel runtime log for the job addresses (`CRON_SECRET`) and the sign-in addresses
  (`WORKOS_*`).

## Assess

For each secret, look for use that is not ours.

| Secret | Where to look | What counts as a sign |
|---|---|---|
| Database | Neon console monitoring (connections, activity) and any logs the plan keeps; the evidence branch; the audit trail | Connections from outside Vercel's regions or the owner's own address; changes with no matching audit event; a broken audit chain (`/app/admin`, signal "Audit log integrity") |
| Blob token | The Blob store's contents and usage graphs; `storage_objects` compared with what is in the store | Objects missing from the store, objects not in the table, unexpected deletions |
| Cookie password | Sign-ins from unfamiliar places in the WorkOS events; sessions that no one started | Sessions with no matching sign-in event |
| CRON_SECRET | Vercel log for the job addresses | A call to a job address at a time Vercel did not schedule |
| Email key | Resend log | Email the product did not send; a spike in volume |
| AI key | Provider usage page; `AI_*` audit events; the spend signal | Spend or calls with no matching audit event |
| Account logins | The provider's own sign-in and audit logs | Any unfamiliar sign-in, new member, new token, changed setting |

If the evidence shows use, treat it as a SEV1 and open [data-exposure.md](./data-exposure.md) in
parallel. If it shows no use, say so in the log with the evidence that supports it. "We did not
see any" is only worth writing down if you say where you looked.

## The master key (`KMS_LOCAL_MASTER_KEY_BASE64`)

This key wraps the data keys that encrypt protected profile fields and stored AI keys.

- **If it leaks and the database did not,** the key alone decrypts nothing. Keep the value as it
  is, tighten who can read the Vercel environment, and treat the key as compromised for the day a
  database copy might also leak.
- **If it leaks and a copy of the database (or a backup) may have leaked too,** protected fields
  and stored AI keys must be treated as exposed. Go to [data-exposure.md](./data-exposure.md).
- **Do not simply change the value.** The key provider can only unwrap with the version it is
  configured for, and there is no tool to re-wrap existing data under a new key. A changed value
  would make every protected field unreadable.
- **This is a known gap, not a procedure.** Before commercial launch the product must move to a real
  key service (the code refuses the local key in commercial mode) and a re-wrap tool must exist and
  have been rehearsed. Until then the honest position is that this key cannot be rotated.

## Notify and escalate

Follow the README. A leaked secret with no sign of use is usually not a notifiable event by itself;
the legal reviewer decides, and decides from the evidence you gathered. A secret that was used to
read or change data is.

## Recover

1. After the redeploy, check `GET /api/health/ready` returns ready, sign in, upload a made-up
   file, and open the admin Operations page to see the signals are healthy.
2. Check the scheduled jobs still run (the Vercel cron list) and that email still sends if it is on.
3. Remove the old secret everywhere: the old provider key cancelled, old GitHub secret values
   replaced, local `.env` files on laptops replaced.
4. Search for the old value in the repository, its history, build logs and chat exports so you know
   every place it sat.

## After

Postmortem as in the README. Questions: how did it get there, and why was that possible? Would a
secret scan on every pull request have caught it (no such scan runs on this private repository today; it is planned work in the supply-chain task)? Should a
person who left lose access to a place they could read secrets from? Which secrets can we now make
shorter-lived or narrower?
