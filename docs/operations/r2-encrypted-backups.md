# R2 documents and encrypted database recovery

2026-10-10 implementation, public beta PR-04. This does not certify real-data intake.

## Documents

`STORAGE_PROVIDER=r2` selects the S3-compatible adapter. Keep `BLOB_READ_WRITE_TOKEN`
and `BLOB_SIGNING_SECRET`: new documents are mirrored to the existing private file
store and R2, and old documents still resolve through that store. Both copies are
deleted by the existing authorized erasure and reconciliation paths. No old objects
are moved or removed during rollout. Backfilling old documents is a separate reviewed
operation. Removing either credential or reverting the provider does not constitute
an approved migration or backup-retention change.

R2 uses `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL` and the fixed
private bucket `visastack-document-backups`. Disable public bucket access and public
R2 custom domains. Limit the token to this bucket. App reads use the existing signed,
short-lived, authorized delivery route, never a public R2 URL. Document object paths
contain only a quarantine/clean namespace and the server-generated opaque key.
SQL archives live under `database/`, outside document reconciliation. Expiring
encrypted account exports retain their existing provider and limits, without permanent
R2 replication. Pre-registration verification uses an internal quarantine read; normal
Vercel file delivery still rejects unregistered objects. The S3 SDK loads only when
R2 is used, avoiding a cold-start penalty on unrelated authentication routes.

`POST /api/documents/upload?applicantId=<uuid>` accepts a raw body with same-origin
session cookies, `Origin`, exact `Content-Length` and supported `Content-Type`.
The raw-body endpoint caps requests at 4 MiB, below Vercel's 4.5 MB ceiling. Existing
forms retain their application quota but Vercel's own request limit still applies.
Larger uploads require a separately reviewed direct-to-quarantine upload flow.
Ownership is checked before reading the stream; actual bytes are bounded independently
of the declared size. The existing quota reservation, registration, job and deletion
services remain authoritative. MIME declarations must match binary signatures.
Stored bytes are read back and their SHA-256 must match before registration.

Original legal evidence is never rewritten to "sanitize" its header. Existing safe
preview rendering produces derivatives. The pure JavaScript structural guard rejects
executables, unsupported active types, spoofed declarations, invalid DOCX structure
and oversized bodies. It is not antivirus and cannot guarantee detection of embedded
payloads. PDF stays blocked without a real scanner. Real-data intake remains closed
until the independent malware, key-management and recovery requirements are met.

## Sensitive fields

`PROTECTED_FIELDS_PGCRYPTO=required` wraps new string envelopes with PostgreSQL's
`pgp_sym_encrypt_bytea`, AES-256, through parameterized SQL before persistence.
The database receives already encrypted bytes, never applicant plaintext or a stored
decryption key. The passphrase is domain-separated from the existing unwrapped data
key. Inner AES-256-GCM authentication still binds the applicant, fact, field and
version. An outer PGP layer alone would not provide that binding.

Native rows carry a format marker plus the existing 12-byte nonce, totaling 13 bytes.
Legacy 12-byte envelopes remain readable. Disabling the write flag does not disable
native reads. No schema migration, production backfill, key replacement or rotation
is performed. Missing pgcrypto fails closed and errors omit bound values. This is
native encryption, not managed KMS or key escrow. Existing recovery material must be
retained independently of the application and database.

Deploy this dual-reader code with native writes disabled first. After verifying that
deployment, enable the write flag and redeploy the same commit. Keep the first
deployment as the rollback target. Once native rows exist, never roll back to an
older build that cannot read the 13-byte format. Disabling the flag stops new native
writes while preserving reads of rows already written.

## Weekly SQL capture

The owner selected GitHub Actions for complete SQL dumps. The pinned official
PostgreSQL 18 client supports the observed Neon PostgreSQL 17 database. It runs on
the existing Actions runner, with no persistent external container service.
The workflow is `.github/workflows/database-backup.yml`.

Use repository Actions secrets in Settings > Secrets and variables > Actions, which
works with GitHub Free private repositories. Configure these secrets securely:

| Secret | Purpose |
| --- | --- |
| `BACKUP_DATABASE_URL` | Direct, unpooled Neon connection with permission to dump every required schema |
| `R2_ENDPOINT_URL` | R2 HTTPS account endpoint |
| `R2_ACCESS_KEY_ID` | Bucket-scoped write credential |
| `R2_SECRET_ACCESS_KEY` | Matching R2 secret |
| `BACKUP_ENCRYPTION_KEY_BASE64` | Independently generated 32-byte AES key, with separate recovery escrow |

Set repository Actions variable `BACKUP_ENCRYPTION_KEY_ID` to a stable version label such
as `backup-v1`. Retain old keys and their IDs for all retained archives. These GitHub
bindings are separate from Vercel's variables. Never paste values into an issue or chat.
The current connection cannot manage GitHub secrets; secure setup remains an owner task.
Limit repository and workflow write rights to trusted maintainers: a main-only workflow
condition is not an isolation boundary against someone who can modify workflows.
If the existing plan supports private-repository environment protection, move bindings
into a main-only `production-backups` environment and add that environment to the job.
That upgrade is optional, not a prerequisite or a new paid service.

GitHub schedules capture Sundays at 06:00 UTC. Vercel's existing daily jobs are
preserved; its added weekly job runs at 07:00 UTC and checks the latest completion
manifest plus archive existence and size. It returns a coarse failure when configuration
or provider access is unavailable. Optional Vercel secret `GITHUB_BACKUP_DISPATCH_TOKEN`
needs fine-grained Actions write permission for this repository only; it permits a
fallback dispatch if no fresh capture exists. Without it GitHub's own schedule still
runs; missing fallback configuration returns 503. An accepted dispatch returns 202
with `backupCompleted=false`. It never reports a queued run as a successful capture.

`pg_dump --format=plain --no-owner --no-privileges` produces a consistent SQL dump,
including schema, functions, sequences and table data available to the backup role.
No tables are silently skipped: permission failures abort capture. It does not back
up cluster roles, ownership/ACL configuration, external object bytes or Neon Auth's
provider configuration. Verify required Auth schemas and provider restore procedures
before claiming account recovery. Restore roles and privileges must be reviewed.

The client enforces verified TLS. Credentials never enter command arguments or logs.
Dump stdout goes straight into streaming AES-256-GCM and a bounded R2 multipart upload,
one 5 MiB part at a time. No plaintext dump is written to disk. The versioned header,
key ID and fresh nonce are authenticated; the authentication tag terminates the archive.
Partial multipart uploads are aborted. A failed dump never creates a success manifest.
Only after dump and upload succeed does the workflow record hash, size, source commit
and completion time, then update `database/latest.json`.

Weekly capture gives up to a week of independent-copy data loss, plus scheduling
delay; it does not meet the existing 15-minute recovery target. Neon PITR remains
separate. Do not enable a recovery attestation based on a green workflow alone.
Actions minutes and R2 storage use the providers' existing free allowances; archive
growth and retention require monitoring. No automatic archive deletion is introduced.

## Restore verification

Download the selected archive and its immutable manifest using an authorized R2
client. Compare SHA-256 and size before extraction. With the matching key and ID in
secure environment bindings, run:

```sh
pnpm --filter @visastack/adapters exec tsx src/restore-backup.ts /private/path/archive.sql.vsbk > /private/path/verified.sql
```

The utility uses a private temporary directory and mode-0600 scratch file, authenticates
the entire dump before releasing SQL, and deletes scratch data even on failure.
Use an appropriately protected, encrypted scratch volume for sensitive restores.
It never connects to or writes a database. SQL extraction is not a restore approval.

Restore only to an explicitly approved isolated database using the compatible psql
client with `ON_ERROR_STOP=1`. Verify tables, functions, sequences, audit integrity,
keys, identity links and object hashes. Then run the existing restored-branch
reconciliation and replay erasure tombstones before any access. Do not create a tenth
Neon branch or overwrite production to run a drill. Record actual recovery time and
data-loss bounds. A synthetic local drill does not establish production recovery.

Production database binding: the application uses `visastackdev` on the main Neon branch. The workflow fixes `BACKUP_EXPECTED_DATABASE=visastackdev`; the backup runner refuses a different database before reading data or opening storage. Verify the secret selects this database and its direct main endpoint. A variable named `DATABASE_URL_UNPOOLED` is not proof that it selects the same database as the application.

## Region configuration and existing bucket failure (2026-10-11)

Every R2 client reads `R2_REGION`, defaulting to `auto` when absent or empty, and retains `forcePathStyle: true`. The database backup workflow reads this optional value from the Actions secret of the same name. New deployments create new process clients; this adapter does not cache bucket lookups. Setting `auto` does not change the previously hard-coded region and must not be presented as proof that a bucket is reachable.

The latest read-only production probe still returns `404 NoSuchBucket` from the account endpoint with the bucket correctly in the request path. Do not switch `STORAGE_PROVIDER` to R2, delete documents, rotate encryption keys or bypass readiness until a real bucket probe succeeds. Bucket inventory and location must be checked through the Cloudflare account console or an authorized management API; object access credentials do not provide that management access.

## Daily SQL capture and retention (2026-10-29, S27)

This section supersedes the weekly schedule, the weekly freshness check, the data-loss bound and "No automatic archive deletion is introduced" in "Weekly SQL capture" above. Everything else there still applies.

- **Schedule.** `.github/workflows/database-backup.yml` runs every day at 05:17 UTC (cron `17 5 * * *`, off the busy top of the hour), plus manual dispatch. One run at a time (`concurrency: production-database-backup`, never cancelled midway), 30-minute limit.
- **Data-loss bound.** Up to about one day of independent-copy data loss, plus GitHub's schedule delay, instead of up to a week. This still does not meet the 15-minute recovery point target (H05); Neon point-in-time restore stays the shorter window.
- **Freshness check.** The Vercel job `/api/jobs/process-database-backup` now runs daily at 11:07 UTC (`apps/web/vercel.json`, `7 11 * * *`; Hobby crons may start any time in that hour), about six hours after the capture, and accepts only a completed capture under 24 hours old (`BACKUP_FRESHNESS_MAX_AGE_MS`, `packages/adapters/src/backup-status.ts`, using the same manifest parser as pruning, which also refuses a completion time more than 10 minutes in the future). When that morning's capture failed, the newest one is about 30 hours old, so the check fails the same day and asks GitHub for a fallback run when `GITHUB_BACKUP_DISPATCH_TOKEN` is set. This changes an existing cron from weekly to daily; it adds no cron (the project has 20, each once a day, within the Hobby plan's once-a-day rule).
- **What each run writes.** One encrypted archive `database/<time>-<run id>-<attempt>.sql.vsbk`, one immutable manifest `<archive>.manifest.json` (written once, never overwritten) and an overwrite of `database/latest.json`. A failed run writes no manifest and aborts its partial upload, so it never replaces the last good backup as the latest.
- **Storage report and pruning.** After each successful capture the workflow runs `packages/adapters/src/backup-prune.ts`. It prints the total size under `database/` and the number of verified archives, adds a warning to the run above 8 GB (R2's free allowance is 10 GB, shared with the document mirror in the same bucket), lists every archive without a verified manifest, and prints what the retention rules would delete. It deletes only when the repository Actions variable `BACKUP_PRUNE` is exactly `on`. **It is not set yet: until the owner sets it, nothing is deleted and archives are kept indefinitely.** The R2 credential must be allowed to delete objects in the bucket for pruning to work.
- **Retention rules (`packages/adapters/src/backup-retention.ts`, unit tested).** Keep every archive completed in the last 35 days; keep the newest archive in each of the 12 calendar weeks up to the 35-day line (the week holding the line and the 11 before it; fixed weeks, so a daily prune does not move them); always keep the newest 7 archives with a verified manifest, whatever their age; always keep the archive `database/latest.json` names. A deleted archive goes with its manifest. An archive with no verified manifest (a failed or interrupted run) is reported and deleted, with any manifest file it has, only once older than 2 days; a manifest whose archive no longer exists is deleted once older than 2 days. Nothing at all is deleted when no archive has a verified manifest or the newest one is older than 2 days (captures may be failing, so the old copies may be the only good ones), and nothing outside archives and their manifests is ever touched. A listing or manifest read failure, or a listing that claims more pages without a way to read them, stops the step before anything is deleted. With a daily capture and a daily prune, a 200-day simulation settles at 36 daily archives plus 11 or 12 weekly ones (the line week may hold none yet), the oldest at most about 119 days (35 days plus 12 weeks) old.
- **Storage numbers.** At an archive size of S MB, about 48 x S MB is kept once pruning is on (for example 1 GB at 20 MB archives). Until then daily runs add about 30 x S MB a month, so the free 10 GB lasts at most about 10,000 / S days (20 MB archives: about 500 days; at the restore drill's 512 MiB limit: about 19 days). The real size is in each manifest's `size` field and in the run's storage line.
- **Artifacts and minutes.** The workflow uploads no GitHub artifacts; only its logs are kept, for GitHub's log retention period (90 days by default). The repository is public, so standard GitHub-hosted runner minutes are free; if it becomes private, the free private allowance applies (2,000 minutes a month on GitHub Free).
- **Erased data in backups.** Erasure in the live database does not reach archives already taken. Erased records can survive in archives as long as those archives are kept: indefinitely until `BACKUP_PRUNE=on`, then up to about 119 days (longer only if captures stop). The privacy data map states the same (`docs/commercial-v1/privacy-data-map.md`, "Backup retention correction").
- **Not verified yet.** Neither the daily schedule nor the prune step has run. Check the first scheduled run's result, its storage line and the new `database/latest.json` completion time the day after this change reaches main.

### Restore runbook with daily captures

Restore steps are unchanged (see "Restore verification" above and `docs/operations/database-restore-drill.md`). Choose the newest archive whose immutable manifest exists and whose SHA-256 and size match, normally the one in `database/latest.json`. With daily captures, the expected data loss is the time since that manifest's `completedAt`. If the newest archive fails its checks, step back one day at a time; each step back adds about a day of data loss. Once pruning is on, archives older than 35 days exist only weekly.
