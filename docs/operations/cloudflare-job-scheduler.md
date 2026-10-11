# Durable job scheduling

The optional Cloudflare Worker in `infra/cloudflare` calls the existing protected notification endpoint every five minutes. Intake polling is opt-in through `ENABLE_INTAKE_SCHEDULE=true`; upload-driven intake dispatch stays intact. Date-based notification sweeps run at the UTC hour boundary. The existing daily Vercel cron entries remain as fallback triggers. Deploying the Next.js application alone does not activate this Worker.

The Worker accepts only `https://vs.obsidianglobal.studio`, refuses redirects, bounds each request to 55 seconds and never logs credentials or response bodies. Its public endpoint returns 404. Independent jobs still run when another fails, but the scheduled invocation fails visibly if any endpoint fails. Notification, intake and reminder endpoints return 503 when their database worker cannot run.

## Installation and secrets

Use an authenticated Cloudflare Workers account with permission to deploy this Worker. R2 S3 access keys do not grant this permission. From `infra/cloudflare`, use the official Wrangler CLI to set `CRON_SECRET` with `wrangler secret put CRON_SECRET`, entering the existing production cron secret through its secure prompt. Then deploy with `wrangler deploy`. Never place the secret in `wrangler.toml`, a command argument or a commit. No production database or R2 credential is needed by the scheduler.

Confirm the deployed schedule and invocation outcomes in Cloudflare, then inspect the founder's backlog indicators. Do not manually invoke production jobs to send test email. Use synthetic staging records for timing and recovery acceptance. Observe at least one actual five-minute run and hourly reminder sweep before claiming the timing objectives are met.

## Costs and limits

This design avoids increasing Vercel Hobby cron frequency and does not require a long-running container or a GitHub Actions runner for each tick. The schedule produces 288 invocations and 312 endpoint requests per day by default, or 600 requests with intake polling enabled. An intake request may start a GitHub Actions scanner even when the queue is empty; enable that optional polling only after measuring runner minutes and backlog. Requests still count toward Vercel usage, database activity and any downstream provider quotas. Check the current Cloudflare account limits, scheduled execution limits and Vercel plan limits before activation. These counts are design estimates, not measured billing or proof of free-plan compatibility.

Resend deduplicates a stable notification key within its provider retention window. This reduces retry duplicates; it does not promise indefinite exactly-once delivery. A provider acceptance ID means accepted, while signed delivery events determine delivered, bounced or failed. Missing email configuration now fails and retries instead of marking an unsent message as sent. Neon Auth confirmation and password-reset messages use their separate authentication provider configuration.

## Rollback

Remove the Worker cron trigger or disable the Worker. The existing Vercel daily fallback remains configured, and all work stays in its existing database queue. Keep the production cron secret private and unchanged unless separately rotating it. A disabled external scheduler restores daily cadence, so record the resulting timing limitation.

## Current acceptance

The Worker source and security checks exist. Cloudflare Workers management access is not available in the current execution environment, so its deployment, observed cadence and account billing limits remain unverified. Application deployment does not close this gap. No paid plan was activated.
