# Private PDF intake on an isolated runner

PDF admission and malware approval are separate. With
`MALWARE_SCANNER_PROVIDER=github_clamav`, authenticated uploads accept supported PDF
bytes into the existing private quarantine and enqueue the existing intake job.
After the upload response, Vercel dispatches trusted main code. A short-lived private
GitHub Actions runner loads current ClamAV signatures, proves clean and infected
control outcomes, and claims the existing queue using its leases and fencing.
Only a real clean verdict allows content-limit checks and text extraction. Files
with threats, encrypted content or scan-limit alerts require attention. Scanner
outages and scan errors remain retryable. Dispatch failure leaves jobs unclaimed.

No document bytes, names, IDs or signed URLs enter workflow events, logs or artifacts.
The worker uses the existing private Vercel store by default. When R2 is activated,
set repository variable `INTAKE_STORAGE_PROVIDER=r2` to match the application;
the worker then reads R2 objects with compatibility reads for Vercel files.
Original evidence is preserved. The worker receives no production browser-link
signing key. Preview and development deployments cannot dispatch production work.
There is no public scanning service, callback URL, duplicate queue or schema migration.

## Secure activation

The repository connection currently cannot manage Actions secrets (HTTP 403).
Configure repository Settings > Secrets and variables > Actions securely:

| Secret | Purpose |
| --- | --- |
| `INTAKE_DATABASE_URL` | Production Neon connection with existing intake read/write permissions |
| `R2_ENDPOINT_URL` | R2 account endpoint, only for the R2 mode |
| `R2_ACCESS_KEY_ID` | Bucket-scoped credential, only for the R2 mode |
| `R2_SECRET_ACCESS_KEY` | Matching credential, only for the R2 mode |
| `BLOB_READ_WRITE_TOKEN` | Existing private Vercel store, for compatibility reads |

Use a dedicated intake role where feasible; it needs the existing queue, document,
scan, extraction, classification and audit writes. A read-only backup role cannot
process documents. Do not reuse a backup encryption key or grant schema migration
permissions. Vercel variables do not populate GitHub secrets.

Set repository variable `DOCUMENT_INTAKE_ENABLED=true` only after secrets are ready.
Set production-only Vercel secret `GITHUB_INTAKE_DISPATCH_TOKEN` to a fine-grained
credential with Actions write permission for this repository. Set production-only
`MALWARE_SCANNER_PROVIDER=github_clamav` and redeploy verified code. Keep the existing private Vercel storage configuration. Do not activate R2 until
its bucket access probe passes; current R2 requests return AccessDenied (HTTP 403).
PDF scanning on the existing Vercel store does not require R2 activation. Never add the dispatch credential
to a PR preview. The manual workflow must run on main; its default disabled guard
prevents accidental queue processing before configuration. Scheduled catch-up runs
at 04:15 Asia/Dhaka daily; uploads are the primary immediate trigger.

Copy any non-default `QUOTA_MAX_PDF_PAGES` and `QUOTA_MAX_IMAGE_MEGAPIXELS` values
into the worker's environment before activation so application and worker limits agree.
Defaults come from the same service configuration. Each run processes at most ten
jobs, one lease at a time. An unfinished queue remains durable. Scanner setup,
GitHub scheduling, concurrency and queued bursts add processing latency; this is
asynchronous processing, not a promise of instant extraction. Failed dispatches,
failed workflows and queue age need operational monitoring. Retry parked jobs using
the existing authorized retry mechanism after correcting the cause.

## Verification and upgrade

Before live activation, prove an authenticated synthetic PDF upload reaches processed
status and an infected control stays quarantined, with recorded engine version and
fresh signatures. Verify that missing secrets, scanner errors and dispatch failures
leave durable jobs, never clean verdicts. Test against approved synthetic data first.
Existing overall real-applicant, managed-key and recovery gates stay unchanged; this
new execution path does not attest that the entire public beta is ready.

The direct `clamav` provider remains available. When volume grows, move the same
`MalwareScannerPort` and existing intake worker to a continuous private worker and
change the deployment configuration. No document schema, upload API, object key,
queue, extraction contract or stored-file migration is required. Stop dispatching
and disable the Actions worker before switching to avoid unnecessary duplicate work;
existing lease fencing remains a final safeguard.

GitHub Free private repositories have a finite included Actions allowance. The scanner
has no subscription, but runner time, signature-download latency and cold starts are
real costs. Beyond the included allowance, Actions may be billed or stopped according
to the account's budget settings. This is suitable for initial low volume, not unlimited
free scanning. No public upload processing is certified until the live acceptance
above passes. Disabling the worker preserves queued uploads; reverting to `builtin`
blocks new PDFs and cannot finish their scans, so it is not a processing fallback.
