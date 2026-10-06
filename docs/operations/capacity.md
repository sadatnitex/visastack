# Capacity and service objectives

Commercial V1 OPS-01, requirement A33 (directive Part 9 sections 8 and 9). Run date: 2026-10-06.
This page reports what was measured, what was not, and what the numbers can and cannot prove.
The targets below are engineering targets, not a customer commitment, unless a contract adopts them.

## Bottom line

- At the launch size (20 agencies, 200 staff, 5,000 profiles, 1,000 open cases) with 50 people
  active and 5 document jobs running at once, every screen answered well inside the target on the
  test machine. The slowest screen at the 95th percentile was 94 ms (the audited save).
- The run found two real slow spots and fixed both: the agency evidence-request list (1.1 s with the
  database next door, 27 s with the database 40 ms away, for 639 requests) and the traveller documents
  page (1.3 s at 40 ms away). Both now make a fixed number of database queries.
- The numbers are from one sandbox machine with no real network between the app and the database, so
  they are indicative, not a promise. The honest test is a rehearsal against a Neon branch at the
  launch compute size, from the same region as the app. The harness is built to be pointed at it.
- The pilot's built-in scanner refuses every PDF on purpose. A PDF can only be released once a real
  scanner (ClamAV) is configured. Production reports the scanner as unconfigured today.

## Targets and results

| Target (directive section 8) | Measured | Result |
| --- | --- | --- |
| 99.9% monthly availability (engineering target) | Cannot be measured from a sandbox. Needs an outside probe on `/api/health/ready` (see `monitoring.md`) | NOT MEASURED |
| p95 ordinary API under 800 ms, excluding transfer and AI | Slowest screen p95: 94 ms (database next door), 389 ms at 10 ms round trip, 611 ms at 40 ms round trip (audited save, one person) | MET on this machine; the margin shrinks as the database moves away (see "Distance to the database") |
| Meaningful screen feedback under 2 s | Server side only: signed-in screens above; public pages p95 97 ms. A real browser on a real network was not measured | PARTLY MEASURED |
| p95 safe processing of a clean 10-page PDF under 90 s | p95 0.41 s (5 at once, real ClamAV with a tiny signature set, real text extraction), 1.7 s at 10 ms round trip | MET, with the scanner caveat below |
| AI outage: manual core survives | Whole run had no AI provider configured; profile reads and audited edits worked | MET |
| Scanner outage: new document release stops | Real scanner adapter pointed at a dead socket: the file ended QUARANTINED, not released | MET |

## What was built

`packages/load` (private, never deployed). Rerun it with:

1. `packages/load/scripts/start-postgres.sh` starts a throwaway local Postgres and prints its address.
2. (Optional, for PDFs) install and start ClamAV, then `export CLAMAV_SOCKET_PATH=/var/run/clamav/clamd.ctl`.
3. `pnpm --filter @visastack/load load` runs everything and prints a JSON report.
   Settings: `LOAD_SECONDS`, `LOAD_SESSIONS`, `LOAD_DOC_WORKERS`, `LOAD_THINK_MS`, `LOAD_RTT_MS`
   (adds network delay between app and database), `LOAD_PHASES`, `LOAD_REPORT`.
4. `LOAD_HTTP_BASE=http://localhost:3100 pnpm --filter @visastack/load load:http` loads the public pages
   of a running production build.

It refuses to run against anything but a local database. It uses the application's own database driver
(through a small bridge), the real migrations, the real service functions, and the real scanner,
content-limit and text-extraction code. Its own tests run in the normal test suite.

## The dataset (all made up)

20 agencies plus one extra agency that sees every case (the worst case for list screens), 210 staff,
5,000 travellers and profiles, 1,000 open cases spread unevenly (the biggest agency has 236), 2,487 grants,
1,374 assignments, 5,000 tasks, 3,000 evidence requests, 30,050 documents with versions, 60,000 profile facts,
50,500 notifications, one rule pack with 30 requirements. About 87 MB. Seeded in 20 seconds, then analysed
so the database planner has statistics, as production's background maintenance would.

## Results (database next door, no added delay)

| Phase | Result |
| --- | --- |
| One person, idle | Every screen p95 under 64 ms |
| 50 sessions, 1 s thinking time, 60 s, plus 5 document jobs | 2,997 screen views (50 a second), 0 errors; p50 14 ms, p95 39 ms, p99 66 ms |
| Same, no thinking time (stress) | 225 views a second, 0 errors; p50 202 ms, p95 352 ms, p99 479 ms; machine 68% busy |
| 5 document jobs alone (10-page PDF) | 25 of 25 released; p50 0.31 s, p95 0.56 s |
| 150 document jobs queued at once, 5 at a time | All 150 released; each took p95 0.41 s; the last waited 11 s in the queue |

Per screen under the launch load (p50 / p95 / p99, milliseconds):

| Screen | p50 | p95 | p99 |
| --- | --- | --- | --- |
| Traveller home | 12 | 24 | 41 |
| Traveller profile | 9 | 17 | 38 |
| Traveller documents | 20 | 44 | 60 |
| Traveller cases | 10 | 21 | 39 |
| Traveller save an answer (audited write) | 35 | 94 | 102 |
| Agency case list | 17 | 38 | 52 |
| Agency client list | 10 | 19 | 33 |
| Agency case detail | 24 | 53 | 67 |
| Agency evidence requests (admin) | 15 | 36 | 45 |
| Notifications | 9 | 17 | 23 |

## Distance to the database

Production's database is not next door. The harness adds a delay to every message between app and
database. This is the number that shows which screens are sensitive to distance (those making many queries).

| Screen (p95 ms) | Next door | 10 ms round trip | 40 ms round trip |
| --- | --- | --- | --- |
| Traveller documents (one person) | 28 | 96 | 301 |
| Traveller save an answer | 63 | 184 | 611 |
| Agency case list, 1,000 cases | 36 | 92 | 206 |
| Agency evidence requests, 639 rows | 25 | 75 | 196 |
| Launch load, all screens, overall p95 | 39 | 234 | not run |

At 10 ms all screens stay under 400 ms even with 50 people. At 40 ms the audited save is the closest
to the 800 ms target (611 ms for one person, untested under load at that distance). Keeping the app and
the database in the same region matters more than any other setting here.

## Pagination at volume

| List | Rows returned | p50 / p95 (ms), next door |
| --- | --- | --- |
| Case list, biggest normal agency | 236 | 22 / 42 |
| Case list, agency that sees all cases | 1,000 (441 KB) | 30 / 36 |
| Client list, 1,000 cases | 1,000 | 11 / 18 |
| Evidence requests, biggest agency | 639 | 20 / 25 |

The case, client and evidence-request lists return every row; none is paginated in the code today
(only notifications are capped, at 50). At the launch size this is fast, and a screen paints 1,000
rows without trouble in the database layer, but the payload grows linearly (441 KB for 1,000 cases).
No change was made: the measurement does not justify one at this size. Revisit when one agency passes
about 2,000 open cases or when the case list payload passes about 1 MB.

## Slow spots found and fixed

| Where | Cause | Before | After | Guard |
| --- | --- | --- | --- | --- |
| Agency evidence requests (`listEvidenceRequestsForOrgDetailed`) | One applicant lookup per request | 1,079 ms p50 (next door), 7.8 s at 10 ms, 27.5 s at 40 ms, for 639 requests | 20 / 63 / 186 ms | New test with several applicants and requests; proven red when the name matching is broken |
| Traveller documents (`listDocumentsDetailed`) | Three queries per document | 307 ms p50, 377 ms p95 at 10 ms; 918 / 1,314 ms at 40 ms | 85 / 96 and 267 / 301 ms | New test for latest version, pending name proposal, newest classification and a document with no version; proven red when "latest wins" is broken |

The old evidence-request method is kept inside the harness only, so the before and after can be reproduced.

## Resource use (launch load)

| Reading | Value |
| --- | --- |
| Database connections, 50 sessions | up to 11 (24 under stress). The app opens one per request, so this will matter with Neon's pooled address limits |
| App process memory | about 305 MB peak (harness including load generation) |
| Database memory | 365 MB peak (760 MB under stress) |
| Whole machine busy | 21% at launch load, 68% at stress |
| Event loop delay p99 | 31 ms (21 ms stress) |
| Rough cost unit | About 7.6 ms of app CPU per screen view (22.8 CPU seconds over 2,997 views, an upper bound because it includes load generation). Turning this into money needs the owner's plan prices; none were assumed |

## What these numbers do NOT prove

- One machine, 4 cores, shared by the load generator, the database and the scanner. Real hosting separates them.
- No real network: only the delay experiment above, which is an approximation. Cold starts of serverless functions
  were not measured.
- The database was a plain Postgres 16, not Neon. Neon's compute size, pooler limits and cold wake-up were not tested.
- ClamAV ran with a one-signature test database because the signature download was blocked in the sandbox. A real
  signature set makes each scan slower; the 0.41 s PDF figure is therefore optimistic. The 90 s target leaves a very large
  margin, but the true figure is unmeasured.
- Files were held in memory, so private blob storage time is not included.
- Profile values were stored as plain text; the cost of decrypting protected fields was not measured.
- The audit chain started empty. Every write appends to it, and chain growth over months was not tested.
- No AI provider, email or payment calls were made.
- A browser was not used: the signed-in screens were measured at the service layer, and the 2-second feedback target
  is therefore only partly covered.
- `/trust` could not be loaded in the public-page check (it reads the database, which the web server could not reach here).
  It failed with a 500 when the database was missing, which is worth deciding on separately (should a public page survive a
  database outage?). `/`, `/status` and the health probe were measured: p95 97 ms at 50 sessions.
- Each run lasted 60 seconds (30 for stress). Long soak behaviour, memory growth and slow leaks were not tested.

## Next steps

1. Rehearse the same run against a Neon branch at the launch compute size, from the same region as the app
   (point `LOAD_DATABASE_URL` at it; the harness requires a local address today and the guard would need a
   deliberate, reviewed change).
2. Configure ClamAV with a real signature set and rerun the document phases.
3. Add an outside uptime probe on `/api/health/ready` so availability is measured, not assumed.
4. Re-run after any change to the list screens or the audited write path.
