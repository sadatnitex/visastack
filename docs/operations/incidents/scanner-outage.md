# The virus scanner is down, missing or wrong

Read [README.md](./README.md) first. Directive Part 9 section 8: if the scanner is out, new
documents must not be released.

## Where we are today

**No antivirus is configured in production.** The status page shows "Virus scanning of uploads:
Not set up yet", and `GET /api/health/ready` reports `malwareScanning: unconfigured`. Uploads are
checked only by the built-in structural checker (real file type from the first bytes, size limits,
active content such as embedded scripts in a PDF, the real structure of a DOCX). That is a useful
filter and it is not an antivirus.

That is acceptable for a controlled pilot that holds made-up data only, and it is the reason the
pilot banner says so. **It is not acceptable for real users' documents.** Before any real document
is accepted, a real scanner must be configured (`MALWARE_SCANNER_PROVIDER=clamav` with
`CLAMAV_SOCKET_PATH`, or `CLAMAV_HOST` and `CLAMAV_PORT`). The production host for the scanner
process is still an open decision (`docs/commercial-v1/cost-and-vendor-register.md`, ClamAV
entry). Commercial mode refuses to start without it.

The rest of this page is for the day a real scanner is configured and then stops working.

## What the system does by itself

- A scan that errors, times out, or is refused because the signature database is too old gives no
  verdict. It is recorded as an errored scan (`document_scan_results.scan_errored`), not as
  "unsafe" and not as "clean".
- A document with no verdict is **not released**. The code never previews or downloads a version
  unless its safety status is `CLEAN`; every other status (`PENDING`, `SCANNING`, `QUARANTINED`,
  `FAILED`) is kept away from readers.
- The job that processes the document retries with growing delays (30 seconds, one minute, two,
  four, and so on) and then parks as failed. Parked jobs appear on `/app/admin`, "Failed intake
  jobs", with a Retry button. Nothing in the product lets anyone mark a document clean by hand. That
  must stay true.
- The user sees "Some documents are still being checked" on their documents page and the page
  refreshes itself, so they are not asked to upload the file again.

## How you might find out

- `/app/admin` Operations, "Operational signals": "Malware scanner availability" turns amber on
  any scan without a verdict in 24 hours and red at three in one hour. "Intake queue age" and "Job
  failures" follow.
- A user says a document has been "still being checked" for a long time.
- `server_error` and `job_failure` events in the Vercel runtime log.
- Nothing watches this from outside. No alert is set up (see `monitoring.md`), so someone has to
  look at the admin page.

## Contain

1. Declare and open the log. This is SEV2 (a security control is down) unless a document is thought
   to have been released without a scan, which is SEV1.
2. **Do not bypass the scanner.** Do not point the product at the built-in checker "to get things
   moving", do not edit a status in the database, do not mark a version clean. A document waiting
   is the system working as designed.
3. Tell affected users plainly, with no cause or data statements: "Uploads are waiting to be
   checked and will appear when the check is back." The incident owner approves this one; anything
   more goes through the legal reviewer.
4. If the cause is a recent change (an environment edit, a deploy), stop making changes and note
   exactly what changed and when.

## Find the cause

Work from the outside in.

| Question | How to check |
|---|---|
| Is the product pointing at the scanner it should? | Admin Operations, "Platform readiness detail": a `*_PROVIDER` setting that names a provider this build does not implement makes readiness degraded. Check `MALWARE_SCANNER_PROVIDER` and the socket or host and port variables in Vercel |
| Is the scanner process up and reachable? | On the scanner host: is `clamd` running, does a `PING` answer `PONG`. From outside: can the host and port be reached from Vercel's network |
| Is its signature database fresh? | On the host: when did `freshclam` last succeed. A database older than the product's freshness limit makes every scan refuse. That shows as errored scans while the process is up |
| Is it overloaded? | Large files, many at once. Look at memory and queue age |
| Did something change? | Vercel deployment list and environment history, GitHub Actions, the host's own change log |

## Recover

1. Fix the cause (restart `clamd`, run `freshclam`, restore the network path, put the environment
   back).
2. **Prove it with known inputs before trusting it:** in a non-production environment, upload the
   standard EICAR antivirus test file and a small clean file. EICAR must be refused, the clean file
   must reach `CLEAN`. (The test suite uses the same public test string.) In production you may do
   the same with a made-up account during the pilot.
3. On `/app/admin`, "Failed intake jobs", retry the parked jobs. Watch "Intake queue age" fall and
   "Malware scanner availability" return to OK.
4. **Check that nothing slipped through.** Against the evidence branch (or a read-only connection),
   this must return no rows other than very old versions from before scan results were recorded:

   ```sql
   select v.id, v.document_id, v.safety_status, v.created_at
   from document_versions v
   where v.safety_status = 'CLEAN'
     and not exists (
       select 1 from document_scan_results r
       where r.document_version_id = v.id
         and r.scan_errored = false
         and r.safe = true
     )
   order by v.created_at desc;
   ```

   Any recent row is a document that was released without a recorded clean verdict. Treat that as
   SEV1: quarantine it by the product's own means, and go to [data-exposure.md](./data-exposure.md).

## Preserve evidence

Follow the README. For this scenario keep the errored scan rows for the window
(`select * from document_scan_results where scan_errored and scanned_at >= '<start>'`), the
scanner host's own log, and the date the signature database was last updated.

## Notify and escalate

A scanner outage with no document released is an availability incident, not a data incident, and
the notice in step 3 of "Contain" is usually all that is needed. A released-but-unscanned document
is different and goes through the legal reviewer.

## After

Postmortem as in the README. Questions: how long was it down before anyone knew? Should "signature
database age" be measured, not guessed (the scanner port does not report it today)? Should the
status page tell users when scanning is not working, instead of only when it is not set up?
