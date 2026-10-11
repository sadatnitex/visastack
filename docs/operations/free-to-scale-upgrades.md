# Provider upgrades without replacing the product

Keep the existing adapter boundaries, durable queues, account identifiers and storage object keys. A provider upgrade changes configuration and capacity; it must not silently change consent, human review, document visibility or founding access. No paid plan is activated by this procedure.

| Service | Current path | Upgrade procedure | Required acceptance |
| --- | --- | --- | --- |
| Hosting | Vercel with daily fallback cron | Review current usage and plan limits; preserve project, domains, environment scope and existing cron secret | Exact revision deployed, public aliases correct, protected jobs refuse anonymous requests |
| Scheduling | Optional Cloudflare Worker using existing job endpoints | Supply Workers deployment access separately from R2 credentials; check execution limits and actual scheduler usage | Five-minute triggers, hourly reminders, failed invocations visible and queue recovery proven |
| Database | Neon with durable job and domain tables | Upgrade the same project first; retain TLS and unpooled backup connection | Application and backup target the same intended database; test recovery before changing endpoints |
| Documents and archives | Private Cloudflare R2 with S3-compatible adapter | Review actual object usage, request limits and billing; preserve jurisdiction, bucket and private access | Private put/read/delete with synthetic data, no public objects, encrypted archive restore |
| Email | Resend application adapter and separate Neon Auth SMTP | Verify sender domain, limits, signed webhook and delivery; upgrade same provider when justified | Accepted messages have provider IDs; signed receipts reconcile delivery; authentication branding stays correct |
| AI | Optional approved adapter with manual fallback | Approve provider privacy and costs before storing a key or enabling processing | Consent, spend cap, timeout/refusal fallback and human approval; never send real documents to an unapproved provider |
| Scanning | Configured actual scanner through the existing quarantine boundary | Increase runner/scanner resources when measured queues justify it | Safe samples process, malicious samples remain quarantined, stale signatures fail safely |

Before each change record the current revision, domain aliases, nonsecret configuration names, provider usage and relevant limits. Export encrypted backups and prove recovery in isolation. Test with synthetic records in an isolated environment. Preserve founding plan price at zero and make paid assignment an explicit separate action. Confirm quotas and access rules before and after the change. If a provider fails, restore the prior configuration and retain queued work; do not mark unsent messages delivered or release unscanned documents.

Current evidence does not establish free-plan headroom or zero billing. Provider dashboard readings and actual invocation counts are required. Application-tracked evidence bytes exclude archives and overhead, and application AI units do not independently verify current provider prices. The admin display must retain these distinctions and report unavailable readings explicitly.
