import type { MigrationStatus } from '@visastack/db';
import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { excludingDeterministicRuns } from './ai-run-kinds';
import { checkRecentAuditChain } from './audit';
import { type Db, schema } from './db';
import { databaseErrorCode } from './error-report';

/**
 * Operational signals (Commercial V1 OPS-03, directive Part 9 section 7 and
 * Part 3 section 13): what an operator needs to see to know whether the platform
 * is healthy, read for the platform-admin page.
 *
 * Every reading here is a count, an age or a ratio computed from tables the
 * product already keeps. Nothing carries an identifier, a name or any content,
 * so the page that shows them cannot leak what it measures.
 *
 * Some signals cannot be read from inside the application and are not faked:
 * availability, request latency, error rate and connection pressure are platform
 * metrics (Vercel and Neon), reported as `not_measured` with where to look. One
 * the directive names does not exist as a feature (an AI circuit breaker) and is
 * reported as `not_built`, with the nearest real measurement beside it.
 *
 * The thresholds are pilot defaults that have not been calibrated against real
 * traffic. They decide a colour on an admin page, never an automatic action.
 */

export type SignalStatus = 'ok' | 'warning' | 'critical' | 'not_measured' | 'not_built';

/** Where the reading comes from, so nobody mistakes a log search for a live gauge. */
export type SignalSource = 'database' | 'platform' | 'log_event' | 'not_built';

export interface OperationalSignal {
  readonly key: OperationalSignalKey;
  readonly label: string;
  readonly status: SignalStatus;
  readonly source: SignalSource;
  /** The short reading, in plain words. */
  readonly reading: string;
  /** What it means and, when it is not measured here, where to look. */
  readonly detail: string;
}

export const OPERATIONAL_SIGNAL_KEYS = [
  'core_availability',
  'request_latency',
  'error_rate',
  'database_errors',
  'connection_pressure',
  'schema_migrations',
  'job_queue_age',
  'job_failures',
  'scanner_availability',
  'signature_age',
  'render_failures',
  'object_storage_failures',
  'abandoned_uploads',
  'notification_backlog',
  'email_failure',
  'denied_access',
  'audit_integrity',
  'ai_spend',
  'ai_circuit_breaker',
  'deletion_job_failures',
] as const;

export type OperationalSignalKey = (typeof OPERATIONAL_SIGNAL_KEYS)[number];

/** Pilot defaults. Unmeasured: see the module comment. */
export const SIGNAL_THRESHOLDS = {
  queueAgeWarningSeconds: 15 * 60,
  queueAgeCriticalSeconds: 60 * 60,
  failedJobsCritical: 5,
  scannerErroredLastHourCritical: 3,
  /** The sweeper removes a reservation 24 hours after it expires; this is how long past that is overdue. */
  abandonedUploadOverdueHours: 25,
  abandonedUploadsWarning: 1,
  abandonedUploadsCritical: 25,
  emailFailureShareWarning: 0.05,
  emailFailureShareCritical: 0.2,
  emailFailureMinimumCount: 3,
  deniedLastHourWarning: 20,
  deniedLastHourCritical: 100,
  deniedBaselineMultipleWarning: 3,
  deniedBaselineMultipleCritical: 10,
  aiFailureShareDegraded: 0.5,
  aiFailureMinimumRuns: 5,
  auditCheckEvents: 500,
} as const;

export interface AiSpendInput {
  /** Cost units spent so far, across every AI task. */
  readonly spentUnits: number;
  /** The point at which spend is called out as high. */
  readonly warningUnits: number;
  /** The ceiling beyond which no AI call is made. */
  readonly limitUnits: number;
}

export interface CollectSignalsInput {
  readonly now?: Date;
  readonly ai?: AiSpendInput;
  /** Result of the migration drift check, supplied by the layer that ships the journal. */
  readonly migrations?: MigrationStatus;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function minutes(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function percent(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

function severity(value: number, warning: number, critical: number): SignalStatus {
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'ok';
}

async function count(query: Promise<ReadonlyArray<{ n: number | string }>>): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.n ?? 0);
}

/** Seconds from `from` to `now`, computed in SQL so the driver's date type never matters. */
function ageSeconds(now: Date, column: unknown) {
  return sql<
    number | null
  >`extract(epoch from (${now.toISOString()}::timestamptz - min(${column})))`;
}

const PLATFORM_SIGNALS: ReadonlyArray<
  Pick<OperationalSignal, 'key' | 'label' | 'source' | 'detail'>
> = [
  {
    key: 'core_availability',
    label: 'Core availability',
    source: 'platform',
    detail:
      'Not measured inside the app: an app cannot report its own outage. Probe /api/health/ready from outside (an uptime monitor) and alert on a non-200. This page loading and reading the database is the only in-app evidence.',
  },
  {
    key: 'request_latency',
    label: 'Request latency',
    source: 'platform',
    detail:
      'Not measured inside the app. Vercel Observability records function duration per route; alert there on p95. No latency target has been measured yet (see the service objectives work).',
  },
  {
    key: 'error_rate',
    label: 'Error rate',
    source: 'platform',
    detail:
      'Not measured inside the app. Vercel records 5xx per route. Unhandled server errors are also logged as a sanitised "server_error" event (no query values, no addresses) that a log alert can count.',
  },
  {
    key: 'database_errors',
    label: 'Database errors',
    source: 'log_event',
    detail:
      'Logged, not counted here: a failed request writes a sanitised "server_error" event with the database error code. Search the production runtime log for that event name; the database provider (Neon) shows its own error counts.',
  },
  {
    key: 'connection_pressure',
    label: 'Database connection pressure',
    source: 'platform',
    detail:
      'Not measured inside the app. Neon shows connection count against the plan limit; alert there. The application opens one short-lived pooled connection per request and closes it.',
  },
  {
    key: 'render_failures',
    label: 'Preview render failures',
    source: 'log_event',
    detail:
      'Logged, not counted here: a preview that cannot be rendered writes a "render_failure" event with the content type only. Search the production runtime log for that event name.',
  },
];

export async function collectOperationalSignals(
  db: Db,
  input: CollectSignalsInput = {},
): Promise<readonly OperationalSignal[]> {
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);

  /** A signal whose own read fails is reported as unreadable; it never hides the others. */
  async function guarded(
    key: OperationalSignalKey,
    label: string,
    read: () => Promise<
      Omit<OperationalSignal, 'key' | 'label' | 'source'> & { source?: SignalSource }
    >,
  ): Promise<OperationalSignal> {
    try {
      const result = await read();
      return { key, label, source: 'database', ...result };
    } catch (error) {
      const code = databaseErrorCode(error);
      return {
        key,
        label,
        status: 'not_measured',
        source: 'database',
        reading: 'could not be read',
        detail: `The query failed${code ? ` (database error ${code})` : ''}. A missing table after a deploy usually means a migration has not been applied; see the schema migrations signal.`,
      };
    }
  }

  const database = await Promise.all([
    guarded('schema_migrations', 'Database migrations', async () => {
      const migrations = input.migrations;
      if (!migrations) {
        return {
          status: 'not_measured',
          reading: 'not checked',
          detail: 'The caller did not supply this build’s migration journal.',
        };
      }
      if (migrations.pending.length === 0) {
        return {
          status: 'ok',
          reading: `${migrations.applied} of ${migrations.expected} applied`,
          detail: 'The database has every migration this build ships.',
        };
      }
      return {
        status: 'critical',
        reading: `${migrations.pending.length} pending`,
        detail: `This build ships migrations the database has not applied: ${migrations.pending.join(', ')}. Pages that read the newer tables will fail until the migrate workflow is run.`,
      };
    }),

    guarded('job_queue_age', 'Intake queue age', async () => {
      const [row] = await db
        .select({ age: ageSeconds(now, schema.processingJobs.availableAt) })
        .from(schema.processingJobs)
        .where(
          and(
            eq(schema.processingJobs.status, 'PENDING'),
            lte(schema.processingJobs.availableAt, now),
          ),
        );
      const age = row?.age === null || row?.age === undefined ? null : Number(row.age);
      if (age === null) {
        return {
          status: 'ok',
          reading: 'nothing waiting',
          detail: 'No intake job is waiting to be picked up.',
        };
      }
      return {
        status: severity(
          age,
          SIGNAL_THRESHOLDS.queueAgeWarningSeconds,
          SIGNAL_THRESHOLDS.queueAgeCriticalSeconds,
        ),
        reading: `oldest waiting job: ${minutes(age)}`,
        detail:
          'How long the oldest due document-processing job has waited. A growing age means the periodic worker is not running or cannot keep up.',
      };
    }),

    guarded('job_failures', 'Job failures', async () => {
      const outstanding = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.processingJobs)
          .where(eq(schema.processingJobs.status, 'FAILED')),
      );
      const lastDay = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.processingJobs)
          .where(
            and(
              eq(schema.processingJobs.status, 'FAILED'),
              gte(schema.processingJobs.updatedAt, dayAgo),
            ),
          ),
      );
      return {
        status: severity(outstanding, 1, SIGNAL_THRESHOLDS.failedJobsCritical),
        reading: `${outstanding} failed and unresolved (${lastDay} in the last 24 hours)`,
        detail:
          'Processing jobs that exhausted their retries and need an administrator to retry them. Each failure is also logged as a "job_failure" event.',
      };
    }),

    guarded('scanner_availability', 'Malware scanner availability', async () => {
      const total = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.documentScanResults)
          .where(gte(schema.documentScanResults.scannedAt, dayAgo)),
      );
      const erroredDay = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.documentScanResults)
          .where(
            and(
              eq(schema.documentScanResults.scanErrored, true),
              gte(schema.documentScanResults.scannedAt, dayAgo),
            ),
          ),
      );
      const erroredHour = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.documentScanResults)
          .where(
            and(
              eq(schema.documentScanResults.scanErrored, true),
              gte(schema.documentScanResults.scannedAt, hourAgo),
            ),
          ),
      );
      const status: SignalStatus =
        erroredHour >= SIGNAL_THRESHOLDS.scannerErroredLastHourCritical
          ? 'critical'
          : erroredDay > 0
            ? 'warning'
            : 'ok';
      return {
        status,
        reading: `${erroredDay} of ${total} scans in 24 hours could not reach a verdict (${erroredHour} in the last hour)`,
        detail:
          'A scan that errors, times out or is refused by a stale signature database gives no verdict, so the document is not released. While this is red, new documents stay in quarantine.',
      };
    }),

    guarded('signature_age', 'Scanner signature age', async () => {
      const [latest] = await db
        .select({
          name: schema.documentScanResults.scannerName,
          version: schema.documentScanResults.scannerVersion,
        })
        .from(schema.documentScanResults)
        .orderBy(sql`${schema.documentScanResults.scannedAt} desc`)
        .limit(1);
      return {
        status: 'not_measured',
        reading: latest ? `latest scan used ${latest.name} ${latest.version}` : 'no scan yet',
        detail:
          'The scanner port does not report signature age, so it is not read live. A ClamAV database older than its freshness limit makes every scan refuse, which shows up above as scans without a verdict.',
      };
    }),

    guarded('object_storage_failures', 'Object storage failures', async () => {
      const failedUploads = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.uploadIntents)
          .where(
            and(
              eq(schema.uploadIntents.status, 'FAILED'),
              gte(schema.uploadIntents.updatedAt, dayAgo),
            ),
          ),
      );
      const failedDeletes = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.erasureJobs)
          .where(eq(schema.erasureJobs.status, 'FAILED')),
      );
      return {
        status: failedDeletes > 0 ? 'critical' : failedUploads > 0 ? 'warning' : 'ok',
        reading: `${failedUploads} failed uploads in 24 hours, ${failedDeletes} stuck deletions`,
        detail:
          'Uploads that failed after a reservation, and stored files that could not be deleted. A stuck deletion is a retention obligation not yet met.',
      };
    }),

    guarded('abandoned_uploads', 'Abandoned uploads', async () => {
      const overdueBefore = new Date(
        now.getTime() - SIGNAL_THRESHOLDS.abandonedUploadOverdueHours * HOUR_MS,
      );
      const overdue = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.uploadIntents)
          .where(
            and(
              eq(schema.uploadIntents.status, 'RESERVED'),
              lt(schema.uploadIntents.expiresAt, overdueBefore),
            ),
          ),
      );
      const waiting = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.uploadIntents)
          .where(
            and(
              eq(schema.uploadIntents.status, 'RESERVED'),
              lt(schema.uploadIntents.expiresAt, now),
            ),
          ),
      );
      return {
        status: severity(
          overdue,
          SIGNAL_THRESHOLDS.abandonedUploadsWarning,
          SIGNAL_THRESHOLDS.abandonedUploadsCritical,
        ),
        reading: `${overdue} overdue for cleanup (${waiting} expired in total)`,
        detail:
          'Reservations the cleanup sweep should already have removed. A reservation is cleaned 24 hours after it expires, so only the overdue count means the sweep is not running.',
      };
    }),

    guarded('notification_backlog', 'Notification backlog', async () => {
      const [row] = await db
        .select({
          n: sql<number>`count(*)::int`,
          age: ageSeconds(now, schema.notifications.createdAt),
        })
        .from(schema.notifications)
        .where(eq(schema.notifications.status, 'QUEUED'));
      const queued = Number(row?.n ?? 0);
      const age = row?.age === null || row?.age === undefined ? null : Number(row.age);
      if (queued === 0 || age === null) {
        return {
          status: 'ok',
          reading: 'nothing queued',
          detail: 'No notification is waiting to be sent.',
        };
      }
      return {
        status: severity(
          age,
          SIGNAL_THRESHOLDS.queueAgeWarningSeconds,
          SIGNAL_THRESHOLDS.queueAgeCriticalSeconds,
        ),
        reading: `${queued} queued, oldest ${minutes(age)}`,
        detail:
          'Notifications waiting to be sent. A growing age means the notification worker is not running or the email provider is failing.',
      };
    }),

    guarded('email_failure', 'Email failure and bounce', async () => {
      const [row] = await db
        .select({
          attempted: sql<number>`count(*) filter (where ${schema.notifications.status} in ('SENT','DELIVERED','BOUNCED','FAILED'))::int`,
          bad: sql<number>`count(*) filter (where ${schema.notifications.status} in ('BOUNCED','FAILED'))::int`,
        })
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.channel, 'EMAIL'),
            gte(schema.notifications.createdAt, dayAgo),
          ),
        );
      const attempted = Number(row?.attempted ?? 0);
      const bad = Number(row?.bad ?? 0);
      const share = attempted === 0 ? 0 : bad / attempted;
      const enough = bad >= SIGNAL_THRESHOLDS.emailFailureMinimumCount;
      const status: SignalStatus = !enough
        ? bad > 0
          ? 'warning'
          : 'ok'
        : severity(
            share,
            SIGNAL_THRESHOLDS.emailFailureShareWarning,
            SIGNAL_THRESHOLDS.emailFailureShareCritical,
          );
      return {
        status,
        reading: `${bad} of ${attempted} emails in 24 hours failed or bounced (${percent(share)})`,
        detail:
          'Emails the provider rejected or that bounced. Bounces arrive through the delivery webhook, so a silent webhook understates this.',
      };
    }),

    guarded('denied_access', 'Denied access', async () => {
      const lastHour = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.result, 'DENIED'),
              gte(schema.auditEvents.occurredAt, hourAgo),
            ),
          ),
      );
      const baselineWindowStart = new Date(now.getTime() - 7 * DAY_MS - HOUR_MS);
      const baselineTotal = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.result, 'DENIED'),
              gte(schema.auditEvents.occurredAt, baselineWindowStart),
              lt(schema.auditEvents.occurredAt, hourAgo),
            ),
          ),
      );
      const baselinePerHour = baselineTotal / (7 * 24);
      const multiple =
        baselinePerHour === 0 ? Number.POSITIVE_INFINITY : lastHour / baselinePerHour;
      const status: SignalStatus =
        lastHour >= SIGNAL_THRESHOLDS.deniedLastHourCritical &&
        multiple >= SIGNAL_THRESHOLDS.deniedBaselineMultipleCritical
          ? 'critical'
          : lastHour >= SIGNAL_THRESHOLDS.deniedLastHourWarning &&
              multiple >= SIGNAL_THRESHOLDS.deniedBaselineMultipleWarning
            ? 'warning'
            : 'ok';
      return {
        status,
        reading: `${lastHour} in the last hour, against about ${Math.round(baselinePerHour * 10) / 10} an hour over the previous 7 days`,
        detail:
          'Authorization refusals recorded in the audit log. A spike well above the usual rate can mean someone probing, a broken permission change, or a client retrying a refused action.',
      };
    }),

    guarded('audit_integrity', 'Audit log integrity', async () => {
      const check = await checkRecentAuditChain(db, SIGNAL_THRESHOLDS.auditCheckEvents);
      if (check.firstBrokenLinkSeq !== null) {
        return {
          status: 'critical',
          reading: `chain broken at event ${check.firstBrokenLinkSeq}`,
          detail:
            'An audit event is not linked to the one before it, so an event was removed, inserted or reordered. Treat as a security incident.',
        };
      }
      if (check.hashMismatches > 0) {
        return {
          status: 'warning',
          reading: `${check.hashMismatches} of the newest ${check.checked} events do not match their hash`,
          detail:
            'The links are intact, but some events do not recompute to their stored hash. That is either an edit or a metadata value that does not survive storage the way it was hashed; investigate before assuming either.',
        };
      }
      return {
        status: 'ok',
        reading: `newest ${check.checked} events chain and recompute correctly`,
        detail: 'Checked the most recent events only, not the whole history.',
      };
    }),

    guarded('ai_spend', 'AI spend', async () => {
      const ai = input.ai;
      if (!ai) {
        return {
          status: 'not_measured',
          reading: 'not checked',
          detail: 'The caller did not supply the configured AI limits.',
        };
      }
      const status: SignalStatus =
        ai.spentUnits >= ai.limitUnits
          ? 'critical'
          : ai.spentUnits >= ai.warningUnits
            ? 'warning'
            : 'ok';
      return {
        status,
        reading: `${ai.spentUnits} of ${ai.limitUnits} cost units (warning at ${ai.warningUnits})`,
        detail:
          'Cost units spent across every AI task against the platform ceiling. At the ceiling no further AI call is made and the manual workflow carries on.',
      };
    }),

    guarded('ai_circuit_breaker', 'AI circuit breaker', async () => {
      const tables = [
        schema.aiExtractionRuns,
        schema.ocrRuns,
        schema.aiClassificationRuns,
        schema.aiExplanationRuns,
        schema.aiInconsistencyRuns,
      ] as const;
      let failed = 0;
      let finished = 0;
      for (const table of tables) {
        const [row] = await db
          .select({
            failed: sql<number>`count(*) filter (where ${table.status} = 'FAILED')::int`,
            finished: sql<number>`count(*) filter (where ${table.status} in ('SUCCEEDED','FAILED'))::int`,
          })
          .from(table)
          .where(
            and(
              gte(table.createdAt, hourAgo),
              inArray(table.status, ['SUCCEEDED', 'FAILED']),
              // Rule-based readings are not AI calls: they never dilute the failure rate.
              table === schema.aiExtractionRuns
                ? excludingDeterministicRuns(schema.aiExtractionRuns.modelVersion)
                : undefined,
            ),
          );
        failed += Number(row?.failed ?? 0);
        finished += Number(row?.finished ?? 0);
      }
      const share = finished === 0 ? 0 : failed / finished;
      const degraded =
        finished >= SIGNAL_THRESHOLDS.aiFailureMinimumRuns &&
        share >= SIGNAL_THRESHOLDS.aiFailureShareDegraded;
      return {
        status: degraded ? 'warning' : 'not_built',
        source: degraded ? 'database' : 'not_built',
        reading: `${failed} of ${finished} AI runs in the last hour failed (${percent(share)})`,
        detail:
          'There is no circuit breaker that stops calling a failing provider. The controls that exist are the platform kill switch, the spend ceiling, the per-document attempt cap and the cross-provider fallback; this reading is the failure rate they are reacting to.',
      };
    }),

    guarded('deletion_job_failures', 'Deletion job failures', async () => {
      const failed = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.erasureJobs)
          .where(eq(schema.erasureJobs.status, 'FAILED')),
      );
      const held = await count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.erasureJobs)
          .where(eq(schema.erasureJobs.status, 'BLOCKED_BY_HOLD')),
      );
      return {
        status: failed > 0 ? 'critical' : held > 0 ? 'warning' : 'ok',
        reading: `${failed} failed, ${held} blocked by a legal hold`,
        detail:
          'Erasure jobs that exhausted their retries are a deletion obligation not met. A job blocked by a legal hold is deliberate and only needs review when the hold lifts.',
      };
    }),
  ]);

  const platform: OperationalSignal[] = PLATFORM_SIGNALS.map((signal) => ({
    ...signal,
    status: 'not_measured',
    reading: signal.source === 'platform' ? 'platform metric' : 'log event',
  }));

  const byKey = new Map<OperationalSignalKey, OperationalSignal>(
    [...database, ...platform].map((signal) => [signal.key, signal]),
  );
  return OPERATIONAL_SIGNAL_KEYS.flatMap((key) => {
    const signal = byKey.get(key);
    return signal ? [signal] : [];
  });
}
