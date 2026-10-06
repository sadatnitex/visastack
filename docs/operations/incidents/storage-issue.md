# Object storage fails, or stored files go missing

Read [README.md](./README.md) first. "Storage" here means the place document bytes live. In
production that is Vercel Private Blob (the app refuses to run uploads without
`BLOB_READ_WRITE_TOKEN`, and the readiness check reports `documentUpload: available` only when the
token is present). The database holds the metadata, the size and the content hash of every object;
the bytes are only in the blob store.

## The gap you must know about before you start

**There is no independent copy of any stored document.** The database can be restored to an earlier
moment (see [restore.md](./restore.md)). The blob store cannot be restored by us: a file that is
deleted, overwritten or lost in the store is gone unless the owner uploads it again. The directive
(and the PRD, OPS-02) says a database restore alone is not a document backup strategy and that a
provider's version history alone is not a proven recovery procedure. Neither a second copy nor a
tested recovery of originals exists yet. Until one does, treat storage loss as unrecoverable and
treat that as an open commercial launch blocker.

## What the system does by itself

- An upload that cannot complete fails closed. No half-made document is left visible; the
  reservation (`upload_intents`) is marked failed or expires and a daily sweep removes leftovers
  (`process-abandoned-uploads`).
- A document is only served when its safety status is `CLEAN` and every read goes through a signed,
  short-lived link that re-checks permission when it is opened.
- A deletion (the owner asks, or retention applies) is a job that deletes the bytes and then checks
  they are gone before the record is marked verified. Jobs that cannot finish show as "stuck
  deletions".
- Quotas stop uploads before the store fills: per file, per applicant, per account and a platform
  warning and hard-stop level (`QUOTA_*` variables).

## How you might find out

- `/app/admin` Operations, "Operational signals": "Object storage failures" (amber on any failed
  upload in 24 hours or any stuck deletion), "Abandoned uploads".
- The "Platform storage" card on the same page (use against the quotas).
- Users: uploads failing, previews not opening, "we could not confirm whether your upload finished"
  (the upload page tells people to check the list of documents before trying again).
- Vercel runtime log: `server_error`, `render_failure`, `abandoned_upload_cleaned`.
- The Vercel status page for Blob, and the provider's own incident notices.

## Contain

1. Declare and open the log. A provider outage with data intact is SEV2 (critical flow down). Missing
   or corrupted files, or a token that may be in the wrong hands, is SEV1.
2. **Do not switch storage backends.** The built-in fallback keeps bytes in the database. It is
   reduced-control and non-commercial and exists for tests and local development only. Removing the
   token to "force" it would make uploads refuse to start (safe, but it stops uploads), and putting
   real data in the fallback would be a separate incident.
3. **If files may be missing, protect what is left.** Check that `CASE_RETENTION_PURGE_ENABLED` and
   `INACTIVE_ACCOUNT_DELETION_ENABLED` are unset or not `true` in Vercel (they are off unless set,
   so automatic purges cannot compound the damage). Do not run "Clean up dangling references" (see
   below) yet; it destroys the list of what is missing.
4. If a token leak is possible, rotate it now: [secret-compromise.md](./secret-compromise.md).
5. Tell affected users plainly and without cause: "Some uploads or previews are not working. Please
   do not upload the same file again until you see the list of documents update." The incident owner
   approves this one.

## Preserve evidence

Follow the README. For this scenario also keep:

- The output of the drift scan below, saved with a date and a SHA-256.
- A copy of the `storage_objects` and `documents` rows for the affected applicants (the evidence
  branch already holds them).
- The provider's incident notice or support ticket reference.

## Assess

1. **Scan for drift.** On `/app/admin`, "Orphan reconciliation", use **Scan for drift (dry run)**. It
   reports dangling references (a record with no bytes behind it, which means a lost file), blobs
   with no record, duplicate references, and size or hash mismatches (corruption). It changes
   nothing. Save the full result.
2. **Count what the database believes exists.** On the evidence branch:

   ```sql
   select bucket, count(*) as objects, coalesce(sum(size_bytes), 0) as bytes
   from storage_objects
   group by bucket;

   select status, count(*), min(created_at), max(created_at)
   from upload_intents
   where created_at >= now() - interval '1 day'
   group by status;

   select created_at, status, failure_reason
   from upload_intents
   where status = 'FAILED' and created_at >= now() - interval '1 day'
   order by created_at desc
   limit 100;
   ```

3. **Name the owners.** For every dangling reference, find the document and the applicant (follow
   `storage_objects.object_key` to the document version, then to the applicant). Write the list in
   the incident log, with the dates and the document types, not the file contents. This is the
   list the owners will have to be told about.
4. **Decide the cause.** Provider outage (back by itself), our deletion (an erasure or purge job
   that should not have run: check `ERASURE_VERIFIED`, `RETENTION_PURGE_QUEUED` and
   `MISSION_RETENTION_PURGED` events in the window), a leaked token used by someone else, or a
   bug. If anyone other than the system deleted or read files, go to
   [data-exposure.md](./data-exposure.md).

## Recover

- **Provider outage, data intact:** wait for the provider, then run the drift scan again, retry any
  parked jobs on "Failed intake jobs", and confirm the signal returns to OK. Users whose upload failed
  upload again.
- **Files lost or corrupted:** the owner must upload the files again. Say so plainly in the notice
  the legal reviewer approves. Only after the list of affected documents is saved in the log, use
  **Clean up dangling references**. It removes a record that has no bytes and no remaining document
  and never deletes bytes that still exist.
- **After the fix,** run the drift scan once more and keep the clean result in the log.

## Notify and escalate

Lost or exposed files are a data incident: the legal reviewer decides who is told and how. A plain
availability notice with no data statement does not need that.

## After

Postmortem as in the README. The standing question for this scenario: what would it have cost if
every file had gone? Record the decision on an independent document backup (a second store, with
version history and deletion protection, and a restore that has actually been rehearsed) and who owns
it. Until that exists, this page cannot honestly say recovery is possible.
