# Render fallback: running VisaStack on Render's free plan

Written 30 Oct 2026, while Vercel has paused production (402 DEPLOYMENT_DISABLED until 29 Nov 2026) for going over the Hobby plan's CPU fair-use limit. This page is the owner's step-by-step guide to move the live site to Render for free, and to move it back. Nothing here changes how the site runs on Vercel.

## What you get, and the honest limits

- The same app, the same database, the same files and the same address (https://vs.obsidianglobal.studio). People sign in with the same accounts.
- Render's free web service has 512 MB of memory and a tenth of a processor. Pages are slower than on Vercel, and a large upload or a big iPhone photo can run out of memory; the service then restarts by itself within a minute or two.
- It goes to sleep after 15 minutes with no visits. The next visit waits about 30 to 60 seconds while it wakes up. Scheduled jobs wake it themselves.
- Render includes a small monthly amount of outbound traffic on the free plan (reported as 5 GB a month since 23 April 2026). Fine for a pilot with made-up data, not for a busy site.
- Free plans are not meant for paying customers. Keep the site in its current controlled pilot. Commercial readiness keeps showing "commercial-compatible hosting" as not met on Render, on purpose.
- Refunds sent to SSLCOMMERZ need a fixed outbound address registered with them. Render's free plan shares its outbound addresses, so keep `PAYMENT_REFUNDS_VIA_GATEWAY` off on Render.

## How it is built (already done in the code)

- The app is packed into one container image by a GitHub workflow you start by hand (Actions, **Render Image**, Run workflow, branch main). It builds on GitHub's machine, checks the image (the image libraries load, and the no-secret smoke check passes against it with placeholder settings that reach no real service), then publishes it as `ghcr.io/sadatnitex/visastack-web:latest`.
- Render only downloads that finished image and runs it. Building on Render's free plan is not used: its build minutes are limited (500 a month) and a monorepo build of this size risks running out of memory there. The image route uses none of Render's build minutes.
- Render's free plan has no scheduler, so a second GitHub workflow (**Render Cron**) calls the same 21 daily jobs on the same times as Vercel does. It is off until you switch it on.
- The image is built from `apps/web/Dockerfile` with `NEXT_OUTPUT=standalone`; on Vercel that setting is absent, so Vercel builds exactly as before.

## Step 1: build the image (about 15 minutes, once per update)

1. GitHub, the visastack repository, **Actions**, **Render Image**, **Run workflow**, branch **main**, **Run workflow**.
2. Wait for the green tick. The run summary names the published image.
3. First time only: make the image downloadable by Render. Either:
   - Public (simplest; the code is already public and the image holds no settings or secrets): GitHub, your profile, **Packages**, **visastack-web**, **Package settings**, **Change visibility**, **Public**; or
   - Private: in Render, **Workspace Settings**, **Registry Credentials**, add your GitHub user name and a GitHub token that can only read packages, and pick that credential when creating the service.

## Step 2: create a free Render account and the service

1. Sign up at render.com (no card needed for the free plan).
2. **New**, **Web Service**, **Existing Image**. Image URL: `ghcr.io/sadatnitex/visastack-web:latest`.
3. Settings:
   - Name: `visastack` (the service gets the address `https://visastack.onrender.com` or similar; note it).
   - Region: the one closest to the database. Look in Neon, the project, **Settings**, region. For AWS US East pick **Virginia**; for an EU region pick **Frankfurt**. If unsure, pick **Virginia**: Vercel has been running the app in its default Washington DC region.
   - Instance type: **Free**.
   - Health Check Path: `/api/health/live` (answers as soon as the app runs; it does not depend on the database, so a database hiccup never makes Render restart the site).
   - Leave the port alone. The image listens on 10000, Render's default.
4. Add the environment variables below, then **Deploy Web Service**.

## Step 3: environment variables (names only; copy each value from Vercel)

Open Vercel, the project, **Settings**, **Environment Variables**, filter **Production**, and copy every variable that is set there into Render (**Environment**, **Add Environment Variable**, or **Add from .env** to paste many at once). Skip names starting with `VERCEL_` (Vercel sets those itself) and any old `WORKOS_` names. Vercel hides values marked sensitive; for those, use your own saved copy, or make a new value where the list below says it is safe to.

One setting is new on Render and must be added there:

| Name | Value | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://vs.obsidianglobal.studio` | The address used in emails and links. On Vercel the app can work it out; on Render it must be set, or links would point at the old Vercel address. Until it is set, readiness says not ready, with that reason on the founder dashboard. |

The image already sets `HOSTING_PLATFORM=render`, which tells the app it is the live site on Render (the private document scanner and the daily backup check may start, and visitor addresses are read the way Render delivers them). It wins over any `VERCEL_ENV` copied across, so copying Vercel's list cannot confuse it.

The names the app reads, grouped, so you can tick them off. Copy only the ones Vercel Production has.

| Group | Names | What they are for |
| --- | --- | --- |
| Basics | `DEPLOYMENT_MODE` (`controlled_pilot`), `PUBLIC_BETA_OPEN`, `ADMIN_EMAILS`, `PILOT_ALLOWLIST_EMAILS`, `SUPPORT_EMAIL` | Pilot mode, who may register, who the founders are, the support address |
| Database | `DIRECT_DATABASE_URL` if Vercel has it, otherwise `DATABASE_URL`; also `DATABASE_URL_UNPOOLED`, `DATABASE_PROVIDER`, `PROTECTED_FIELDS_PGCRYPTO` | The Neon database connection (the same database as now) and protected fields |
| Sign-in | `IDENTITY_PROVIDER`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `STEP_UP_SIGNING_SECRET`, `STAFF_SECOND_FACTOR` | Neon Auth and the extra checks for sensitive actions. Use the same cookie secret, or everyone is signed out |
| Keys | `KMS_PROVIDER`, `KMS_KEY_ID`, `KMS_AWS_REGION`, `KMS_AWS_ACCESS_KEY_ID`, `KMS_AWS_SECRET_ACCESS_KEY`, `KMS_LOCAL_MASTER_KEY_BASE64` | The master key that protects stored data. Must be identical to Vercel, never a new value |
| Files | `STORAGE_PROVIDER`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`, `BLOB_READ_WRITE_TOKEN`, `BLOB_SIGNING_SECRET`, `QUOTA_MAX_UPLOAD_MB`, `QUOTA_MAX_APPLICANT_EVIDENCE_MB`, `QUOTA_MAX_ACCOUNT_EVIDENCE_MB`, `QUOTA_PLATFORM_WARNING_MB`, `QUOTA_PLATFORM_HARD_STOP_MB` | Private file storage and upload limits |
| Document checks | `MALWARE_SCANNER_PROVIDER`, `GITHUB_INTAKE_DISPATCH_TOKEN`, `DOCUMENT_CONVERTER_PROVIDER`, `PREVIEW_RENDERER_PROVIDER`, `CONTENT_LIMITS_PROVIDER`, `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_SOCKET_PATH` | The private virus scanner and document reading |
| Scheduled jobs and backup | `CRON_SECRET`, `JOB_PROVIDER`, `GITHUB_BACKUP_DISPATCH_TOKEN` | The secret every scheduled job call must carry (copy it into GitHub too, step 6), and the backup check |
| Email | `EMAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_WEBHOOK_SECRET` | Case and workspace email through Resend |
| AI | `AI_ENABLED`, `AI_PROVIDER`, `AI_CONNECTOR_ENABLED`, `OPENAI_API_KEY`, `OPENAI_PROJECT_ID`, `OPENAI_MODEL_PRIMARY`, `OPENAI_REASONING_EFFORT`, `OPENAI_STORE_RESPONSES`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_PRIMARY`, `GEMINI_API_KEY`, `GEMINI_MODEL_PRIMARY`, `AI_PILOT_MONTHLY_HARD_LIMIT_USD`, `AI_PILOT_MONTHLY_WARNING_USD`, `AI_PER_DOCUMENT_LIMIT_USD`, `AI_MAX_ATTEMPTS`, `AI_MAX_PAGES_PER_DOCUMENT`, `AI_CACHE_MAX_AGE_DAYS`, `AI_MAX_CONCURRENT_CALLS` | AI suggestions, budgets and the AI connector |
| Payments | `PAYMENT_PROVIDER`, `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_MODE`, `PAYMENT_REFUNDS_VIA_GATEWAY` (leave off on Render) | Online payments |
| WhatsApp | `WHATSAPP_CHANNEL_ENABLED`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_APP_SECRET_PREVIOUS`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_NUMBER`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_SUPPORT_EMAIL` | The WhatsApp channel, if switched on |
| Keeping and deleting data | `CASE_RETENTION_NOTICE_MONTHS`, `CASE_RETENTION_PURGE_ENABLED`, `CASE_RETENTION_PURGE_GRACE_DAYS`, `INACTIVE_ACCOUNT_NOTICE_MONTHS`, `INACTIVE_ACCOUNT_DELETION_ENABLED`, `INACTIVE_ACCOUNT_DELETION_GRACE_DAYS`, `ACCOUNT_EXPORT_ARTIFACT_HOURS`, `LEGAL_HOLD_REMINDER_INTERVAL_DAYS` | Retention, deletion and export rules |
| Features | `PERSONAL_SHARING_INVITATIONS_ENABLED` | Personal sharing invitations |
| Security and monitoring | `CSP_MODE`, `CSP_FORM_ACTION_EXTRA`, `OBSERVABILITY_PROVIDER`, `SENTRY_DSN` | The browser security policy and error reporting |
| Commercial readiness | every `COMMERCIAL_READINESS_ATTEST_...` and `COMMERCIAL_READINESS_DEFER_...` name Vercel has | Your recorded sign-offs; copy them as they are |

Do not set `NODE_ENV`, `PORT`, `HOSTNAME`, `NODE_OPTIONS` or `HOSTING_PLATFORM`: the image sets them. If the app later gains a setting not listed here, Vercel's list is still the one to copy.

## Step 4: check the service on its Render address

When Render shows **Live**, open `https://<your-service>.onrender.com/api/health/ready`. It should say `"status":"ready"`. If it says `degraded`, usually the database setting is missing or wrong, or a database change is still waiting; the founder dashboard at `/app/admin` shows details once you can sign in.

Sign-in will not work on the onrender.com address yet, and that is expected: Neon Auth only trusts vs.obsidianglobal.studio. Do not add the onrender.com address to Neon Auth; test sign-in after step 5.

## Step 5: move the address to Render

1. A day before, if you can: at your DNS provider, lower the time-to-live (TTL) of the `vs` record to 300 seconds (5 minutes), so the switch and any switch back take effect within minutes instead of hours.
2. Render, the service, **Settings**, **Custom Domains**, **Add Custom Domain**: `vs.obsidianglobal.studio`. Render shows the record it needs, a CNAME pointing at `<your-service>.onrender.com`.
3. At your DNS provider (where obsidianglobal.studio is managed), change the `vs` record from Vercel's target to the target Render shows. If the record is an A record pointing at Vercel, delete it and add the CNAME.
4. Back in Render, press **Verify**. Render issues the security certificate itself, usually within minutes. Free plans include custom domains and certificates.
5. Leave the domain listed in Vercel. Vercel will warn that it is misconfigured; that is fine, and it makes the switch back a DNS change only.

Because the address does not change:
- Neon Auth needs no change: its trusted domain and its email links stay vs.obsidianglobal.studio.
- Resend's delivery webhook, SSLCOMMERZ's payment callbacks, the WhatsApp webhook and the AI connector address (`/mcp`) all keep working with no change.

## Step 6: switch on the scheduled jobs

GitHub, the repository, **Settings**, **Secrets and variables**, **Actions**:
1. **Secrets**, **New repository secret**: `CRON_SECRET`, the same value as `CRON_SECRET` on Render.
2. **Variables**, **New repository variable**: `CRON_BASE_URL` = `https://<your-service>.onrender.com` (the Render address reaches the service whatever the DNS says).
3. **Variables**, **New repository variable**: `CRON_HOST` = `render`. This switches the jobs on.
4. Optional: **Variables**, `PUBLIC_SITE_URL` = the public address, if it is ever not https://vs.obsidianglobal.studio.
5. To check at once: **Actions**, **Render Cron**, **Run workflow**, job `/api/jobs/process-rate-limit-prune`. It should finish green with status 200.

A built-in guard stops double runs. Before any job, the workflow asks the public address (`PUBLIC_SITE_URL`) for its light liveness page. If Vercel answers it, and Vercel is not paused, Vercel's own scheduler is running the jobs, so every job is skipped, the run still ends green, and the summary shows a warning saying to turn `CRON_HOST` off. If Render answers, or Vercel answers "paused" (402, when Vercel runs no jobs), the jobs run. The guard cannot see the case where Vercel is running again but the address still points at Render; see "Switching back to Vercel".

The daily billing run, reminders, notifications, retention, account exports, payment checks and the backup check then run every day at the times in `apps/web/vercel.json`. GitHub sometimes starts scheduled runs a few minutes late; all these jobs are daily, so that is harmless. GitHub also turns off scheduled workflows in a repository with no activity for 60 days; any push resets that.

## Step 7: verify the live site

1. https://vs.obsidianglobal.studio/api/health/ready says ready.
2. Sign in with your own account, open the workspace.
3. Upload one made-up test document and see it appear in the documents list.
4. Optional: **Actions**, **Live signed-in check**, **Run workflow** (it signs in to the real address with the test account).
5. Once, after the first deploy: check that sign-in limits see your real address. On Render, add `CLIENT_ADDRESS_CHECK` = `log-once` to the service, let it restart, open the sign-in page and sign in once. In Render, **Logs**, find the line starting `[client-address] Render check` and compare the address in it with your own (search the web for "what is my IP"). Then delete `CLIENT_ADDRESS_CHECK`. If the two differ (for example the log shows an address that is the same for everyone), tell the engineering session: sign-in limits would then be shared by all visitors, which is safe but stricter than intended.

The automatic after-deployment checks (Deploy Smoke, Playwright Deploy Smoke) do not run on Render deployments: they start from Vercel's deployment notices. The Render Image workflow runs the smoke check on the image before it is published instead.

## Updating the site while it is on Render

After a change is merged to main: run **Render Image** again. If you added the optional secret `RENDER_DEPLOY_HOOK_URL` (Render, the service, **Settings**, **Deploy Hook**; copy the address into a GitHub repository secret of that name), Render deploys the new image straight away; otherwise press **Manual Deploy**, **Deploy latest reference** on Render. Database changes (migrations) still run only through the usual migration workflow with your word.

## Switching back to Vercel

When Vercel resumes (29 Nov 2026) or after upgrading the Vercel plan:
1. Turn the GitHub jobs off FIRST: delete the `CRON_HOST` variable (or set it to `off`). If you skip this, every job runs twice a day: once from Vercel and once from GitHub. The jobs are written so a second run finds nothing left to do (an invoice is created once, a reminder is queued once), but it is still wasted work and a needless risk.
2. At your DNS provider, point the `vs` record back to Vercel's target (shown in Vercel, the project, **Settings**, **Domains**). With a 5-minute TTL, visitors move within minutes.
3. Check https://vs.obsidianglobal.studio/api/health/ready, sign in, and confirm in Vercel that the domain shows as valid.
4. Suspend the Render service (Render, the service, **Settings**, **Suspend**) so the two copies never run at once. Keep it, so the next switch takes minutes.

If Vercel resumes while the address still points at Render and you want to stay on Render for now, Vercel's own scheduled jobs start again against the same database. Turn them off in Vercel (the project, **Settings**, **Cron Jobs**, **Disable Cron Jobs**) until you switch back, then turn them on again and turn `CRON_HOST` off.

## What has not been checked

- The service has not been created on Render; Render's site could not be opened from the build machine, so the facts above come from Render's documentation as quoted in search results, checked on 30 Oct 2026. In particular, that the free instance type accepts a prebuilt image (rather than only code from GitHub) is not confirmed; if Render refuses it, choose **Starter** for the first month or ask for help to switch to a Render build.
- Render is reported to add to a visitor's own forwarding header (`x-forwarded-for`) rather than replace it. On Render the app therefore uses only the last address in that header, the one Render's proxy adds, and ignores the headers a visitor could write themselves (`x-real-ip`, `cf-connecting-ip`): no Render document found says its edge always overwrites them. Requests with no forwarded address share one limit. That the last address is the visitor's own, not a Render or Cloudflare machine, is not confirmed; the one-time log check in step 7 settles it.
- The image and its checks were built and passed on a local machine, with a 512 MB memory limit. A real sign-in, upload, virus scan and job run on Render have not happened yet.
- Whether Vercel Blob (used for the private mirror copy of files) keeps working while the Vercel project is paused is not confirmed.

Sources: Render free plan (render.com/docs/free), prebuilt images (render.com/docs/deploy-an-image), health checks (render.com/docs/health-checks), build pipeline minutes (render.com/docs/build-pipeline), default variables (render.com/docs/environment-variables), workspace plan change of 1 Aug 2026 (render.com/docs/new-workspace-plans), forwarding header behaviour (feedback.render.com/features/p/send-the-correct-xforwardedfor, community.render.com).
