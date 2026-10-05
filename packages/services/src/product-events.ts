import { createHash } from 'node:crypto';
import { MISSION_STATES } from '@visastack/core';
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { type Db, schema } from './db';
import { redactErrorMessage } from './error-report';

/**
 * Product events (Build Spec §14/§23-25; Commercial V1 OPS-04, directive Part 9
 * section 10): pseudonymous, access-controlled usage measurement.
 *
 * A minimal, append-only log of known milestones: which one, when, by which
 * account and inside which organization, plus at most one closed-vocabulary
 * label and one measured number. There is no free-text property bag and no PII.
 * `accountId` and `organizationId` are the same opaque identifiers used across
 * the audit trail, never an email or a name, and both are cleared if the account
 * or organization is ever deleted, which is what keeps an erased person's events
 * from being traceable afterwards.
 *
 * What cannot reach this table, by construction: passport numbers, file
 * contents, refusal wording and medical narrative (OPS-04's exclusions). A
 * `dimension` must be one of the tokens its event type allows (below), the
 * database independently rejects anything that is not an UPPER_SNAKE token, and
 * a `metricValue` is a non-negative whole number, so no sentence can be smuggled
 * in through either column.
 *
 * Who can read it: platform administrators, as aggregates only
 * (`getProductAnalytics`), and the account itself, as its own rows in an
 * account export. Nothing else reads it.
 *
 * Recording an event never blocks or fails the business action it describes. It
 * runs in a savepoint inside the caller's transaction, so a failed analytics
 * write (including a database whose schema has not caught up with a deploy) is
 * logged and rolled back on its own while the action commits.
 */

export const PRODUCT_EVENT_TYPES = [
  // The pilot funnel's original milestones.
  'ACCOUNT_CREATED',
  'APPLICANT_CREATED',
  'DOCUMENT_UPLOADED',
  'MISSION_CREATED',
  'GRANT_CREATED',
  'AI_EXTRACTION_RUN',
  'AI_OCR_RUN',
  'AI_CLASSIFICATION_RUN',
  'AI_INCONSISTENCY_RUN',
  // OPS-04.
  'MISSION_STAGE_CHANGED',
  'MISSION_READY_REACHED',
  'EVIDENCE_REQUESTED',
  'EVIDENCE_RECEIVED',
  'EVIDENCE_REWORK_REQUESTED',
  'TASK_OVERDUE',
  'READINESS_GAPS_DETECTED',
  'ACKNOWLEDGEMENT_RECORDED',
  'ACKNOWLEDGEMENT_INVALIDATED',
  'SOURCE_REVIEWED',
  'AI_PROPOSAL_ACCEPTED',
  'AI_PROPOSAL_CORRECTED',
  'AI_PROPOSAL_REJECTED',
  'OUTCOME_RECORDED',
  'COMPLAINT_RESOLVED',
  'ACCOUNT_ACTIVATED',
  'PLAN_CHANGED',
  'PLAN_LIMIT_REACHED',
  'CASH_COLLECTED',
] as const;

export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number];

const AI_TASK_KINDS = ['EXTRACTION', 'CLASSIFICATION', 'INCONSISTENCY'] as const;

/**
 * The label an event type may carry. An array is a closed list; a pattern is for
 * a vocabulary that is open but still a bare token (a currency code). An event
 * type with no entry carries no label at all.
 */
const DIMENSION_RULES: Readonly<Partial<Record<ProductEventType, readonly string[] | RegExp>>> = {
  MISSION_STAGE_CHANGED: MISSION_STATES,
  READINESS_GAPS_DETECTED: [
    'MANUAL_ONLY',
    'NEEDS_ACTION',
    'NEEDS_REVIEW',
    'READY_FOR_APPLICANT_REVIEW',
  ],
  EVIDENCE_REWORK_REQUESTED: ['NEEDS_REPLACEMENT', 'CONTRADICTION', 'CORRECTION_PROPOSED'],
  ACKNOWLEDGEMENT_RECORDED: ['ACKNOWLEDGED', 'REJECTED', 'CORRECTION_REQUESTED'],
  SOURCE_REVIEWED: [
    'VERSION_APPROVED',
    'SOURCE_UNREACHABLE',
    'SOURCE_RESTORED',
    'FEE_STALE',
    'FEE_CONFIRMED',
  ],
  AI_PROPOSAL_ACCEPTED: AI_TASK_KINDS,
  AI_PROPOSAL_CORRECTED: AI_TASK_KINDS,
  AI_PROPOSAL_REJECTED: AI_TASK_KINDS,
  OUTCOME_RECORDED: ['APPROVED', 'REFUSED', 'WITHDRAWN', 'CANCELLED', 'OTHER'],
  COMPLAINT_RESOLVED: ['RESOLVED', 'CLOSED', 'WITHDRAWN'],
  ACCOUNT_ACTIVATED: ['TRAVELLER', 'AGENCY'],
  PLAN_CHANGED: ['SUBSCRIPTION_ACTIVATED', 'DOWNGRADE_EXECUTED'],
  PLAN_LIMIT_REACHED: ['SEATS', 'INVITATIONS', 'CASES_PER_PERIOD', 'OPEN_CASES', 'STORAGE'],
  CASH_COLLECTED: /^[A-Z]{3}$/,
};

/** The event types that may carry a measured number, and what the number is. */
const METRIC_EVENTS: ReadonlySet<ProductEventType> = new Set([
  'MISSION_READY_REACHED', // seconds from case creation
  'READINESS_GAPS_DETECTED', // required requirements still unmet
  'COMPLAINT_RESOLVED', // seconds from filing
  'ACCOUNT_ACTIVATED', // seconds from account creation
  'CASH_COLLECTED', // minor currency units
]);

export interface RecordProductEventInput {
  readonly eventType: ProductEventType;
  readonly accountId: string | null;
  readonly organizationId?: string | null;
  /** One of the labels `eventType` allows; see `DIMENSION_RULES`. */
  readonly dimension?: string;
  /** A non-negative whole number; see `METRIC_EVENTS` for what it measures. */
  readonly metricValue?: number;
  /**
   * For an event that must exist at most once per entity (a task becoming
   * overdue, an account being activated, a case first reaching ready): the
   * entity's id. Only a hash of it is stored, and a repeat is silently ignored.
   */
  readonly onceFor?: string;
}

function dimensionAllowed(eventType: ProductEventType, dimension: string): boolean {
  const rule = DIMENSION_RULES[eventType];
  if (rule === undefined) return false;
  return Array.isArray(rule)
    ? (rule as readonly string[]).includes(dimension)
    : (rule as RegExp).test(dimension);
}

/** The reason an input is not recordable, or `null` if it is. */
function invalidReason(input: RecordProductEventInput): string | null {
  if (!PRODUCT_EVENT_TYPES.includes(input.eventType)) return 'unknown event type';
  if (input.dimension !== undefined && !dimensionAllowed(input.eventType, input.dimension)) {
    return 'dimension is not one this event type allows';
  }
  if (input.metricValue !== undefined) {
    if (!METRIC_EVENTS.has(input.eventType)) return 'this event type carries no metric';
    if (!Number.isSafeInteger(input.metricValue) || input.metricValue < 0) {
      return 'metric must be a non-negative whole number';
    }
  }
  return null;
}

/** Messages already logged by this process, so a systemic fault logs once rather than per event. */
const reportedFailures = new Set<string>();

function reportFailure(eventType: string, rawMessage: string): void {
  // A failed insert's error text ends with the values it tried to store.
  const message = redactErrorMessage(rawMessage);
  const key = `${eventType}:${message}`;
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  console.error(`[product-events] ${eventType} was not recorded: ${message}`);
}

/** Forgets which failures were already logged. Test-only: lets each test see its own log line. */
export function resetProductEventLogForTests(): void {
  reportedFailures.clear();
}

function dedupeKeyFor(eventType: ProductEventType, entityId: string): string {
  return createHash('sha256').update(`${eventType}:${entityId}`).digest('hex');
}

/**
 * Append one event. Call it with the same `tx` as the business write it
 * describes, next to that write's audit record. It never throws: an input that
 * is not allowed, or a write that fails, is logged once and dropped.
 */
export async function recordProductEvent(db: Db, input: RecordProductEventInput): Promise<void> {
  const invalid = invalidReason(input);
  if (invalid) {
    reportFailure(input.eventType, invalid);
    return;
  }
  try {
    // A savepoint when `db` is already a transaction: a failed insert rolls back
    // to it and leaves the caller's transaction usable.
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.productEvents)
        .values({
          eventType: input.eventType,
          accountId: input.accountId,
          organizationId: input.organizationId ?? null,
          dimension: input.dimension ?? null,
          metricValue: input.metricValue ?? null,
          dedupeKey: input.onceFor ? dedupeKeyFor(input.eventType, input.onceFor) : null,
        })
        .onConflictDoNothing();
    });
  } catch (error) {
    reportFailure(input.eventType, error instanceof Error ? error.message : String(error));
  }
}

export type ProductEventRow = typeof schema.productEvents.$inferSelect;

/**
 * Every event recorded against one account, for that account's own data export.
 *
 * Until the OPS-04 migration has run, the four newer columns do not exist and a
 * plain `select()` of the table would fail, which would take the whole export
 * down with it. So this falls back to the original four columns and reports the
 * newer ones as empty, which is exactly what those rows hold. Any other failure
 * still surfaces.
 */
export async function listProductEventsForAccount(
  db: Db,
  accountId: string,
): Promise<ProductEventRow[]> {
  try {
    return await db
      .select()
      .from(schema.productEvents)
      .where(eq(schema.productEvents.accountId, accountId));
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    reportFailure('ANALYTICS_READ', error instanceof Error ? error.message : String(error));
    const legacy = await db
      .select({
        id: schema.productEvents.id,
        eventType: schema.productEvents.eventType,
        accountId: schema.productEvents.accountId,
        occurredAt: schema.productEvents.occurredAt,
      })
      .from(schema.productEvents)
      .where(eq(schema.productEvents.accountId, accountId));
    return legacy.map((row) => ({
      ...row,
      organizationId: null,
      dimension: null,
      metricValue: null,
      dedupeKey: null,
    }));
  }
}

/** Seconds elapsed from `from` to `to`, floored and never negative. */
export function elapsedSeconds(from: Date, to: Date = new Date()): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

export interface PilotScorecardRow {
  readonly eventType: ProductEventType;
  readonly total: number;
  readonly last7Days: number;
}

/**
 * One row per known event type (present even at zero, so the admin scorecard
 * never silently omits a milestone that hasn't happened yet in the pilot).
 */
export async function getPilotScorecard(
  db: Db,
  now: Date = new Date(),
): Promise<PilotScorecardRow[]> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      eventType: schema.productEvents.eventType,
      total: sql<string>`count(*)`,
      last7Days: sql<string>`count(*) filter (where ${schema.productEvents.occurredAt} >= ${since.toISOString()})`,
    })
    .from(schema.productEvents)
    .groupBy(schema.productEvents.eventType);

  const byType = new Map(rows.map((row) => [row.eventType, row]));
  return PRODUCT_EVENT_TYPES.map((eventType) => {
    const row = byType.get(eventType);
    return {
      eventType,
      total: Number(row?.total ?? 0),
      last7Days: Number(row?.last7Days ?? 0),
    };
  });
}

/**
 * OPS-04's fourteen named learning areas, each with the event types that
 * evidence it. "Agency repeat use" is not an event of its own: it is read off
 * `MISSION_CREATED` events that carry an organization (see `getProductAnalytics`).
 */
export const PRODUCT_EVENT_CATEGORIES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly eventTypes: readonly ProductEventType[];
}> = [
  {
    key: 'case_stage',
    label: 'Case creation and stage',
    eventTypes: ['MISSION_CREATED', 'MISSION_STAGE_CHANGED'],
  },
  { key: 'intake_to_ready', label: 'Intake to ready', eventTypes: ['MISSION_READY_REACHED'] },
  {
    key: 'evidence',
    label: 'Evidence requested, received and reworked',
    eventTypes: ['EVIDENCE_REQUESTED', 'EVIDENCE_RECEIVED', 'EVIDENCE_REWORK_REQUESTED'],
  },
  { key: 'overdue_tasks', label: 'Overdue tasks', eventTypes: ['TASK_OVERDUE'] },
  { key: 'gaps', label: 'Detected gaps', eventTypes: ['READINESS_GAPS_DETECTED'] },
  {
    key: 'acknowledgement',
    label: 'Acknowledgement and invalidation',
    eventTypes: ['ACKNOWLEDGEMENT_RECORDED', 'ACKNOWLEDGEMENT_INVALIDATED'],
  },
  { key: 'source_review', label: 'Source review', eventTypes: ['SOURCE_REVIEWED'] },
  {
    key: 'ai_decisions',
    label: 'AI acceptance and correction',
    eventTypes: ['AI_PROPOSAL_ACCEPTED', 'AI_PROPOSAL_CORRECTED', 'AI_PROPOSAL_REJECTED'],
  },
  { key: 'outcome', label: 'Outcome', eventTypes: ['OUTCOME_RECORDED'] },
  {
    key: 'complaint_resolution',
    label: 'Complaint resolution',
    eventTypes: ['COMPLAINT_RESOLVED'],
  },
  { key: 'activation', label: 'Activation', eventTypes: ['ACCOUNT_CREATED', 'ACCOUNT_ACTIVATED'] },
  { key: 'agency_repeat_use', label: 'Agency repeat use', eventTypes: ['MISSION_CREATED'] },
  { key: 'plan_usage', label: 'Plan usage', eventTypes: ['PLAN_CHANGED', 'PLAN_LIMIT_REACHED'] },
  { key: 'cash_collection', label: 'Cash collection', eventTypes: ['CASH_COLLECTED'] },
];

export interface AnalyticsCategoryRow {
  readonly key: string;
  readonly label: string;
  readonly total: number;
  readonly last7Days: number;
  readonly last30Days: number;
}

export interface LabelCount {
  readonly label: string;
  readonly count: number;
}

export interface DurationSummary {
  readonly count: number;
  readonly medianSeconds: number | null;
  readonly p90Seconds: number | null;
}

export interface ProductAnalytics {
  readonly generatedAt: Date;
  readonly categories: readonly AnalyticsCategoryRow[];
  /** Case creation to first reaching a ready state. */
  readonly intakeToReady: DurationSummary;
  /** Complaint filing to resolution, closure or withdrawal. */
  readonly complaintResolution: DurationSummary;
  /** Account creation to its first case. */
  readonly activationDelay: DurationSummary;
  readonly casesByStage: readonly LabelCount[];
  readonly outcomes: readonly LabelCount[];
  readonly aiDecisions: {
    readonly accepted: number;
    readonly corrected: number;
    readonly rejected: number;
  };
  readonly planLimitHits: readonly LabelCount[];
  /** Cash collected, by currency, in minor units. */
  readonly cashCollected: ReadonlyArray<{
    readonly currency: string;
    readonly minorUnits: number;
    readonly collections: number;
  }>;
  /** Organizations that created a case in at least two distinct weeks. */
  readonly agencyRepeatUse: {
    readonly activeOrganizations: number;
    readonly repeatOrganizations: number;
  };
}

/**
 * Not yet available: the database has not been migrated to the version that adds
 * the analytics columns. The admin page says so rather than failing.
 */
export type ProductAnalyticsResult =
  | ({ readonly available: true } & ProductAnalytics)
  | { readonly available: false; readonly reason: 'schema_pending' };

const DAY_MS = 24 * 60 * 60 * 1000;

function summarizeDurations(
  rows: ReadonlyArray<{
    readonly eventType: string;
    readonly n: string;
    readonly median: string | null;
    readonly p90: string | null;
  }>,
  eventType: ProductEventType,
): DurationSummary {
  const row = rows.find((r) => r.eventType === eventType);
  return {
    count: Number(row?.n ?? 0),
    medianSeconds: row?.median == null ? null : Math.round(Number(row.median)),
    p90Seconds: row?.p90 == null ? null : Math.round(Number(row.p90)),
  };
}

function sortedLabelCounts(map: Map<string, number>): LabelCount[] {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Aggregates only: counts, medians and sums over the event log. Callers must
 * check the caller is a platform administrator first; this function does not
 * (like `listRecentAuditEvents`, the log spans every tenant by design).
 */
export async function getProductAnalytics(
  db: Db,
  now: Date = new Date(),
): Promise<ProductAnalyticsResult> {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const events = schema.productEvents;

  try {
    const [byTypeAndDimension, durations, cash, repeat] = await Promise.all([
      db
        .select({
          eventType: events.eventType,
          dimension: events.dimension,
          total: sql<string>`count(*)`,
          last7Days: sql<string>`count(*) filter (where ${events.occurredAt} >= ${since7.toISOString()})`,
          last30Days: sql<string>`count(*) filter (where ${events.occurredAt} >= ${since30.toISOString()})`,
        })
        .from(events)
        .groupBy(events.eventType, events.dimension),
      db
        .select({
          eventType: events.eventType,
          n: sql<string>`count(*)`,
          median: sql<
            string | null
          >`percentile_cont(0.5) within group (order by ${events.metricValue})`,
          p90: sql<
            string | null
          >`percentile_cont(0.9) within group (order by ${events.metricValue})`,
        })
        .from(events)
        .where(
          and(
            inArray(events.eventType, [
              'MISSION_READY_REACHED',
              'COMPLAINT_RESOLVED',
              'ACCOUNT_ACTIVATED',
            ]),
            isNotNull(events.metricValue),
          ),
        )
        .groupBy(events.eventType),
      db
        .select({
          currency: events.dimension,
          minorUnits: sql<string>`coalesce(sum(${events.metricValue}), 0)`,
          collections: sql<string>`count(*)`,
        })
        .from(events)
        .where(and(eq(events.eventType, 'CASH_COLLECTED'), isNotNull(events.dimension)))
        .groupBy(events.dimension),
      db
        .select({
          organizationId: events.organizationId,
          weeks: sql<string>`count(distinct date_trunc('week', ${events.occurredAt}))`,
        })
        .from(events)
        .where(
          and(
            eq(events.eventType, 'MISSION_CREATED'),
            isNotNull(events.organizationId),
            gte(events.occurredAt, new Date(now.getTime() - 90 * DAY_MS)),
          ),
        )
        .groupBy(events.organizationId),
    ]);

    // One grouped scan serves every count below.
    const totals = new Map<string, { total: number; last7Days: number; last30Days: number }>();
    const dimensionCounts = new Map<string, Map<string, number>>();
    for (const row of byTypeAndDimension) {
      const current = totals.get(row.eventType) ?? { total: 0, last7Days: 0, last30Days: 0 };
      totals.set(row.eventType, {
        total: current.total + Number(row.total),
        last7Days: current.last7Days + Number(row.last7Days),
        last30Days: current.last30Days + Number(row.last30Days),
      });
      if (row.dimension !== null) {
        const byDimension = dimensionCounts.get(row.eventType) ?? new Map<string, number>();
        byDimension.set(row.dimension, (byDimension.get(row.dimension) ?? 0) + Number(row.total));
        dimensionCounts.set(row.eventType, byDimension);
      }
    }
    const countOf = (eventType: ProductEventType) => totals.get(eventType)?.total ?? 0;

    const categories: AnalyticsCategoryRow[] = PRODUCT_EVENT_CATEGORIES.map((category) => {
      // "Agency repeat use" is shown as the count of case creations that belong
      // to an organization; the repeat measure itself is `agencyRepeatUse`.
      const sum = { total: 0, last7Days: 0, last30Days: 0 };
      for (const eventType of category.eventTypes) {
        const t = totals.get(eventType);
        if (!t) continue;
        sum.total += t.total;
        sum.last7Days += t.last7Days;
        sum.last30Days += t.last30Days;
      }
      return { key: category.key, label: category.label, ...sum };
    });

    const activeOrganizations = repeat.length;
    const repeatOrganizations = repeat.filter((row) => Number(row.weeks) >= 2).length;

    return {
      available: true,
      generatedAt: now,
      categories,
      intakeToReady: summarizeDurations(durations, 'MISSION_READY_REACHED'),
      complaintResolution: summarizeDurations(durations, 'COMPLAINT_RESOLVED'),
      activationDelay: summarizeDurations(durations, 'ACCOUNT_ACTIVATED'),
      casesByStage: sortedLabelCounts(dimensionCounts.get('MISSION_STAGE_CHANGED') ?? new Map()),
      outcomes: sortedLabelCounts(dimensionCounts.get('OUTCOME_RECORDED') ?? new Map()),
      aiDecisions: {
        accepted: countOf('AI_PROPOSAL_ACCEPTED'),
        corrected: countOf('AI_PROPOSAL_CORRECTED'),
        rejected: countOf('AI_PROPOSAL_REJECTED'),
      },
      planLimitHits: sortedLabelCounts(dimensionCounts.get('PLAN_LIMIT_REACHED') ?? new Map()),
      cashCollected: cash
        .filter((row): row is typeof row & { currency: string } => row.currency !== null)
        .map((row) => ({
          currency: row.currency,
          minorUnits: Number(row.minorUnits),
          collections: Number(row.collections),
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      agencyRepeatUse: { activeOrganizations, repeatOrganizations },
    };
  } catch (error) {
    // Only "the columns are not there yet" is expected, and only until the
    // migration runs. Anything else (a dropped connection, a bug) must surface.
    if (!isMissingColumn(error)) throw error;
    reportFailure('ANALYTICS_READ', error instanceof Error ? error.message : String(error));
    return { available: false, reason: 'schema_pending' };
  }
}

/** Postgres `undefined_column` (42703), as raised directly or wrapped by the driver. */
function isMissingColumn(error: unknown): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || depth > 3) return false;
    const { code, message, cause } = value as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === '42703') return true;
    if (typeof message === 'string' && /column .* does not exist/i.test(message)) return true;
    return visit(cause, depth + 1);
  };
  return visit(error, 0);
}
