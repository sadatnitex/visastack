# Monitoring and operational signals

Commercial V1 OPS-03 (directive Part 9 section 7, Part 3 section 13). This page says
what is monitored, where to look, what each reading means and what has NOT been set
up. It is written so that nothing here is taken for a live alert unless it says so.

## What exists today

| Where | What it is | Who can see it |
|---|---|---|
| `GET /api/health/live` | The process is up. No dependency checks, so it never flaps on a database blip. | Anyone |
| `GET /api/health/ready` | One verdict, `ready` (200) or `degraded` (503), plus the deployment mode and the platform capability registry. On a deployed build that is all it says. | Anyone |
| `/app/admin` (the Operations section), card "Operational signals" | Twenty signals, each with a status, a reading and an explanation. | Platform administrators |
| `/app/admin` (the Operations section), card "Platform readiness detail" | The breakdown behind the readiness verdict: database, pending migrations, provider settings, missing sign-in configuration. Names, never values. | Platform administrators |
| Structured log events | One JSON line per event on stdout, captured by the Vercel runtime log. Names below. | Whoever can read the Vercel log |

The public probe is coarse on purpose. A public URL must never reveal which secrets
exist, which provider is configured, or which migration is pending, so on every
deployed build (including a pull request preview, which is a public URL) the readiness
body is the verdict and nothing else. The detail lives behind the admin sign-in.

## Readiness is `degraded` when

- the database cannot be reached, or the base schema is missing;
- the database lacks a migration this build ships (see "Migration drift" below);
- the sign-in (WorkOS) configuration is incomplete;
- a `*_PROVIDER` setting names a provider this build does not implement;
- in commercial mode, any commercial gate is not met.

## Migration drift

`/api/health/ready` used to test only that the `accounts` table exists. Production
therefore reported ready while migrations `0078` to `0082` had never been applied, and
`/app/admin` failed with `relation "ocr_runs" does not exist`. Readiness now compares
the migrations recorded in `drizzle.__drizzle_migrations` with the journal bundled into
the running build, using the migrator's own rule (a migration is pending when its
timestamp is newer than the newest one recorded).

If readiness is `degraded` and the admin page says migrations are pending:

1. Open the repository Actions tab, run **DB Migrate (manual)** on `main`, type `migrate`.
2. Reload `/app/admin`; the "Database migrations" signal turns OK and readiness returns 200.

Applying a migration is a production database change and stays a human decision.

## The signals

Thresholds are pilot defaults and have not been calibrated against real traffic. They
choose a colour on an admin page; they never trigger an automatic action.

| Signal | Source | Reading | Warning / critical |
|---|---|---|---|
| Core availability | platform | Not measured by the app. Probe `/api/health/ready` from outside. | n/a |
| Request latency | platform | Not measured by the app. Vercel Observability, per route. | n/a |
| Error rate | platform | Not measured by the app. Vercel 5xx per route; also the `server_error` log event. | n/a |
| Database errors | log event | `server_error` events carry the database error code. | n/a |
| Database connection pressure | platform | Not measured by the app. Neon shows connections against the plan limit. | n/a |
| Database migrations | database | Applied against shipped, with pending names. | critical if any pending |
| Intake queue age | database | Age of the oldest due, waiting processing job. | 15 min / 60 min |
| Job failures | database | Failed jobs awaiting retry, and how many in the last day. | 1 / 5 |
| Malware scanner availability | database | Scans in 24 h that reached no verdict. | any in 24 h / 3 in 1 h |
| Scanner signature age | not measured | Latest scanner name and version. The scanner port does not report signature age. | n/a |
| Preview render failures | log event | `render_failure` events, content type only. | n/a |
| Object storage failures | database | Failed uploads in 24 h and stuck deletions. | any failed upload / any stuck deletion |
| Abandoned uploads | database | Reservations the 24-hour cleanup sweep should already have removed. | 1 / 25 overdue |
| Notification backlog | database | Queued notifications and the age of the oldest. | 15 min / 60 min |
| Email failure and bounce | database | Share of emails in 24 h that failed or bounced. | 5% / 20% (at least 3 failures) |
| Denied access | database | Authorization refusals in the last hour against the previous 7-day hourly rate. | 20 and 3x / 100 and 10x |
| Audit log integrity | database | Newest 500 events: chain links and hash recomputation. | hash mismatch warns / broken link is critical |
| AI spend | database | Cost units against the warning point and the ceiling. | warning point / ceiling |
| AI circuit breaker | not built | Failure rate of AI runs in the last hour. There is no breaker. | warns at 50% of at least 5 runs |
| Deletion job failures | database | Erasure jobs that exhausted retries, and those held by a legal hold. | held / failed |

Two readings are honest about their limits:

- **AI circuit breaker.** The directive lists it as a metric. No circuit breaker exists
  in the AI gateway. The controls that do exist are the platform kill switch, the spend
  ceiling, the per-document attempt cap and the cross-provider fallback. The signal
  shows the failure rate those controls are reacting to and is labelled "Not built".
- **Audit log integrity.** A broken link (an event removed, inserted or reordered) is
  critical. A hash mismatch with intact links is only a warning, because a metadata
  value that does not survive storage the way it was hashed looks the same as an edit,
  and the two must not be confused.

## Log events to search for

Search the Vercel production runtime log for the event name.

| Event | Severity | Written when | Carries |
|---|---|---|---|
| `server_error` | error | A request or a scheduled job failed. | Where, error type, database error code, the statement text without its values, up to five call sites, a hashed subject reference. Never bound values or addresses. |
| `job_failure` | warning, then error | An intake job attempt failed; error when retries are exhausted. | Job type, an opaque document version id, error code, attempt counts. |
| `abandoned_upload_cleaned` | warning | A cleanup sweep removed something. | Counts. |
| `render_failure` | warning | A preview could not be rendered. | Content type only. |
| `[csp-violation]` | warning | A browser reported a Content-Security-Policy violation. | Directive, templated paths. |

## Alert rules that still have to be created (NOT done)

Nothing below is configured. They are the rules to create in the platform consoles,
and the first two are the ones that would have caught the migration incident.

1. Uptime monitor on `GET /api/health/ready`: alert on any non-200 for two consecutive
   checks. (Catches a database that is down or a build whose migrations are behind.)
2. Vercel log alert on `name:"server_error"` at more than a handful per five minutes.
3. Vercel Observability: p95 duration and 5xx rate per route. Set the threshold once a
   latency target has been measured; no target has been measured yet.
4. Neon: connection count against the plan limit, and storage.
5. A log alert on `"severity":"error"` for `job_failure`.

## Not verified

- No alert is configured anywhere in the platform consoles. Everything above that says
  "alert" is a recommendation.
- The thresholds are unmeasured defaults.
- The admin cards were exercised against a test database and a built page, not rendered
  against the production database in a browser.
- Scanner signature age is not read live. Which scanner is deployed is visible in the
  signal; whether it is a real signature-based scanner depends on provider configuration
  this page cannot see.
