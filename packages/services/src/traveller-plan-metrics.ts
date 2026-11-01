import { type Result, err, ok } from '@visastack/core';
import { eq, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { BILLING_TIME_ZONE } from './billing-standing';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { personBillingPresent } from './traveller-billing';

/**
 * The platform owner's traveller plan metrics and health signals (ADR 0025 section 12.6, T6).
 *
 * - Counted without personal data: Plan & Usage views and Get taps (two daily counters, never
 *   who), and, from billing rows and audit events, checkouts started, payments confirmed,
 *   renewals made and paid, lapses, stops and refunds, by Bangladesh day. Real money only; test
 *   payments are counted apart. From these: conversion, renewal rate and refund rate.
 * - Health signals: checkout success rate, time to confirmation, payments stuck confirming and
 *   payments that need a check, each against a threshold the owner sets (migration 0114), else
 *   the standard one.
 *
 * Platform owner only (`PLANS_MANAGE`). Returns counts and dates only: no id, name or email.
 * Before migrations 0110, 0111 or 0114 it returns what it can and never fails.
 */

const NOT_ALLOWED = 'Only the platform owner can see traveller plan metrics.';
export const TRAVELLER_HEALTH_UNAVAILABLE =
  'Traveller plan thresholds can be set once the database is updated.';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A payment still confirming after this long is stuck (the same as Needs a Check). */
const STUCK_AFTER_MS = 30 * 60 * 1000;
export const TRAVELLER_METRICS_MAX_DAYS = 90;

export type TravellerPlanEvent = 'PLAN_VIEWED' | 'GET_TAPPED';

function denied(staff: unknown): ServiceError | undefined {
  return staffScopeProblem(staff, 'PLANS_MANAGE')
    ? serviceError('forbidden', NOT_ALLOWED)
    : undefined;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** Whether migration 0114 has run. Only a "yes" is cached, per handle. */
const metricsReady = new WeakMap<object, true>();
async function metricsTablesPresent(db: Db): Promise<boolean> {
  if (metricsReady.has(db)) return true;
  const rows = await db
    .select({
      present: sql<boolean>`to_regclass('traveller_plan_daily_counts') is not null and to_regclass('traveller_plan_health_settings') is not null`,
    })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) metricsReady.set(db, true);
  return present;
}

/** The Bangladesh day of `at`, as "2026-11-01". */
function dayOf(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Counts one Plan & Usage view or Get tap for today (Bangladesh day): a number, never who. Never
 * fails the page or the action it counts for: before migration 0114, or on any database error,
 * nothing is counted.
 */
export async function countTravellerPlanEvent(
  db: Db,
  event: TravellerPlanEvent,
  now: Date = new Date(),
): Promise<void> {
  try {
    if (!(await metricsTablesPresent(db))) return;
    const c = schema.travellerPlanDailyCounts;
    await db
      .insert(c)
      .values({ day: dayOf(now), event, count: 1 })
      .onConflictDoUpdate({ target: [c.day, c.event], set: { count: sql`${c.count} + 1` } });
  } catch {
    // Counting is never worth failing what a person was doing.
  }
}

export interface TravellerPlanDay {
  /** The Bangladesh day, "2026-11-01". */
  readonly day: string;
  readonly views: number;
  readonly getTaps: number;
  readonly checkouts: number;
  /** Real payments confirmed on a traveller's own invoice. */
  readonly payments: number;
  readonly renewalsMade: number;
  readonly renewalsPaid: number;
  readonly lapses: number;
  readonly stops: number;
  readonly refunds: number;
}

export interface TravellerPlanMetrics {
  readonly days: readonly TravellerPlanDay[];
  readonly totals: Omit<TravellerPlanDay, 'day'>;
  /** Payments per checkout started, renewals paid per renewal made, refunds per payment: 0 to 1, or null with nothing to divide by. */
  readonly rates: {
    readonly conversion: number | null;
    readonly renewal: number | null;
    readonly refund: number | null;
  };
  /** Payments made in the gateway's test mode in the window, counted apart. */
  readonly testPayments: number;
  /** False before migration 0114: views and Get taps were not counted. */
  readonly countsAvailable: boolean;
}

const EMPTY_DAY: Omit<TravellerPlanDay, 'day'> = {
  views: 0,
  getTaps: 0,
  checkouts: 0,
  payments: 0,
  renewalsMade: 0,
  renewalsPaid: 0,
  lapses: 0,
  stops: 0,
  refunds: 0,
};

const ratio = (top: number, bottom: number): number | null => (bottom > 0 ? top / bottom : null);

/** The last `days` Bangladesh days of traveller plan counts, newest first, for the owner. */
export async function travellerPlanMetrics(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
  input: { readonly days?: number; readonly now?: Date } = {},
): Promise<Result<TravellerPlanMetrics, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const span = Math.max(1, Math.min(input.days ?? 14, TRAVELLER_METRICS_MAX_DAYS));
  const now = input.now ?? new Date();
  const keys: string[] = [];
  for (let back = 0; back < span; back++) keys.push(dayOf(new Date(now.getTime() - back * DAY_MS)));
  const oldest = keys[keys.length - 1] ?? dayOf(now);
  const byDay = new Map<string, { -readonly [K in keyof typeof EMPTY_DAY]: number }>(
    keys.map((day) => [day, { ...EMPTY_DAY }]),
  );
  const add = (
    rows: readonly { day: string; n: number | string }[],
    field: keyof typeof EMPTY_DAY,
  ) => {
    for (const row of rows) {
      const entry = byDay.get(String(row.day));
      if (entry) entry[field] += Number(row.n);
    }
  };
  const zone = BILLING_TIME_ZONE;
  const since = sql`(${oldest}::date::timestamp at time zone ${zone})`;
  const localDay = (column: ReturnType<typeof sql>) =>
    sql`to_char((${column} at time zone ${zone})::date, 'YYYY-MM-DD')`;

  const countsAvailable = await metricsTablesPresent(db);
  if (countsAvailable) {
    const c = schema.travellerPlanDailyCounts;
    const rows = await db
      .select({ day: c.day, event: c.event, n: c.count })
      .from(c)
      .where(sql`${c.day} >= ${oldest}::date`);
    add(
      rows.filter((r) => r.event === 'PLAN_VIEWED'),
      'views',
    );
    add(
      rows.filter((r) => r.event === 'GET_TAPPED'),
      'getTaps',
    );
  }

  // Audit events say what happened, never to whom here: counted by type and day only.
  const audits = rowsOf<{ day: string; event_type: string; n: string | number }>(
    await db.execute(sql`
      select ${localDay(sql`a.occurred_at`)} as day, a.event_type, count(*)::int as n
      from audit_events a
      where a.occurred_at >= ${since}
        and a.event_type in ('PERSON_PLAN_CHECKOUT_STARTED', 'PERSON_PLAN_RENEWAL_INVOICED',
          'PERSON_PLAN_LAPSED', 'PERSON_PLAN_RENEWAL_STOPPED')
      group by 1, 2`),
  );
  add(
    audits.filter((r) => r.event_type === 'PERSON_PLAN_CHECKOUT_STARTED'),
    'checkouts',
  );
  add(
    audits.filter((r) => r.event_type === 'PERSON_PLAN_RENEWAL_INVOICED'),
    'renewalsMade',
  );
  add(
    audits.filter((r) => r.event_type === 'PERSON_PLAN_LAPSED'),
    'lapses',
  );
  add(
    audits.filter((r) => r.event_type === 'PERSON_PLAN_RENEWAL_STOPPED'),
    'stops',
  );

  let testPayments = 0;
  if (await personBillingPresent(db)) {
    // Money on a traveller's own invoice: real payments, and which were renewals (a period that
    // follows on from an earlier one of the same plan).
    const payments = rowsOf<{ day: string; mode: string; renewal: boolean; n: string | number }>(
      await db.execute(sql`
        select ${localDay(sql`p.collected_date`)} as day, p.mode,
          exists (select 1 from invoices prior where prior.subscription_id = i.subscription_id
            and prior.payer_account_id = i.payer_account_id and prior.period_end = i.period_start
            and prior.id <> i.id) as renewal,
          count(*)::int as n
        from invoice_payments p
        join invoices i on i.id = p.invoice_id and i.payer_account_id is not null
        where p.kind = 'ONLINE' and p.collected_date >= ${since}
        group by 1, 2, 3`),
    );
    add(
      payments.filter((r) => r.mode !== 'TEST'),
      'payments',
    );
    add(
      payments.filter((r) => r.mode !== 'TEST' && r.renewal === true),
      'renewalsPaid',
    );
    testPayments = payments
      .filter((r) => r.mode === 'TEST')
      .reduce((sum, r) => sum + Number(r.n), 0);
    const refunds = rowsOf<{ day: string; n: string | number }>(
      await db.execute(sql`
        select ${localDay(sql`r.confirmed_at`)} as day, count(*)::int as n
        from refund_requests r
        where r.payer_account_id is not null and r.status = 'CONFIRMED'
          and r.confirmed_at >= ${since}
        group by 1`),
    );
    add(refunds, 'refunds');
  }

  const days = keys.map((day) => ({ day, ...(byDay.get(day) ?? EMPTY_DAY) }));
  const totals = days.reduce(
    (sum, d) => ({
      views: sum.views + d.views,
      getTaps: sum.getTaps + d.getTaps,
      checkouts: sum.checkouts + d.checkouts,
      payments: sum.payments + d.payments,
      renewalsMade: sum.renewalsMade + d.renewalsMade,
      renewalsPaid: sum.renewalsPaid + d.renewalsPaid,
      lapses: sum.lapses + d.lapses,
      stops: sum.stops + d.stops,
      refunds: sum.refunds + d.refunds,
    }),
    { ...EMPTY_DAY },
  );
  return ok({
    days,
    totals,
    rates: {
      conversion: ratio(totals.payments, totals.checkouts),
      renewal: ratio(totals.renewalsPaid, totals.renewalsMade),
      refund: ratio(totals.refunds, totals.payments),
    },
    testPayments,
    countsAvailable,
  });
}

// --- Health signals and the owner's thresholds -----------------------------------------------

export interface TravellerHealthThresholds {
  /** Below this share of finished checkouts paid, in the last day, it needs attention. */
  readonly checkoutSuccessMinPercent: number;
  /** Above this many minutes from the payment page to confirmed (median, last 7 days). */
  readonly confirmationMaxMinutes: number;
  /** Above this many payments still confirming after 30 minutes. */
  readonly stuckConfirmingMax: number;
  /** Above this many traveller payments held for a check. */
  readonly needsCheckMax: number;
}

export const STANDARD_TRAVELLER_THRESHOLDS: TravellerHealthThresholds = {
  checkoutSuccessMinPercent: 50,
  confirmationMaxMinutes: 15,
  stuckConfirmingMax: 0,
  needsCheckMax: 0,
};

export interface TravellerHealthSettings extends TravellerHealthThresholds {
  /** False before migration 0114: the standard thresholds apply and cannot be changed yet. */
  readonly available: boolean;
  readonly updatedAt: Date | null;
}

async function readThresholds(db: Db): Promise<TravellerHealthSettings> {
  if (!(await metricsTablesPresent(db))) {
    return { ...STANDARD_TRAVELLER_THRESHOLDS, available: false, updatedAt: null };
  }
  const h = schema.travellerPlanHealthSettings;
  const row = first(await db.select().from(h).where(eq(h.id, true)).limit(1));
  if (!row) return { ...STANDARD_TRAVELLER_THRESHOLDS, available: true, updatedAt: null };
  return {
    checkoutSuccessMinPercent: row.checkoutSuccessMinPercent,
    confirmationMaxMinutes: row.confirmationMaxMinutes,
    stuckConfirmingMax: row.stuckConfirmingMax,
    needsCheckMax: row.needsCheckMax,
    available: true,
    updatedAt: row.updatedAt,
  };
}

/** The owner's thresholds (or the standard ones), for the settings form. */
export async function getTravellerHealthSettings(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
): Promise<Result<TravellerHealthSettings, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  return ok(await readThresholds(db));
}

/** Why a set of thresholds cannot be kept, in plain words, or null. */
export function travellerThresholdsProblem(input: TravellerHealthThresholds): string | null {
  const whole = (n: number) => Number.isInteger(n);
  if (
    !whole(input.checkoutSuccessMinPercent) ||
    input.checkoutSuccessMinPercent < 0 ||
    input.checkoutSuccessMinPercent > 100
  ) {
    return 'Checkout success must be a whole number from 0 to 100.';
  }
  if (
    !whole(input.confirmationMaxMinutes) ||
    input.confirmationMaxMinutes < 1 ||
    input.confirmationMaxMinutes > 1440
  ) {
    return 'Time to confirm must be a whole number of minutes from 1 to 1440.';
  }
  for (const n of [input.stuckConfirmingMax, input.needsCheckMax]) {
    if (!whole(n) || n < 0 || n > 1000) return 'Counts must be whole numbers from 0 to 1000.';
  }
  return null;
}

/** The owner changes the thresholds, with a fresh sign-in. Audited; an unchanged set writes nothing. */
export async function updateTravellerHealthSettings(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
  input: TravellerHealthThresholds & { readonly stepUpSatisfied: boolean },
): Promise<
  Result<{ readonly settings: TravellerHealthSettings; readonly changed: boolean }, ServiceError>
> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const problem = travellerThresholdsProblem(input);
  if (problem) return err(serviceError('invalid', problem));
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'changing thresholds requires reauthentication'));
  }
  if (!(await metricsTablesPresent(db))) {
    return err(serviceError('invalid', TRAVELLER_HEALTH_UNAVAILABLE));
  }
  return db.transaction(async (tx) => {
    const before = await readThresholds(tx);
    const values = {
      checkoutSuccessMinPercent: input.checkoutSuccessMinPercent,
      confirmationMaxMinutes: input.confirmationMaxMinutes,
      stuckConfirmingMax: input.stuckConfirmingMax,
      needsCheckMax: input.needsCheckMax,
    };
    const unchanged = (Object.keys(values) as (keyof typeof values)[]).every(
      (key) => before[key] === values[key],
    );
    if (unchanged && before.updatedAt !== null) {
      return ok({ settings: before, changed: false });
    }
    const h = schema.travellerPlanHealthSettings;
    const now = new Date();
    await tx
      .insert(h)
      .values({ id: true, ...values, updatedByAccountId: staff.accountId, updatedAt: now })
      .onConflictDoUpdate({
        target: h.id,
        set: { ...values, updatedByAccountId: staff.accountId, updatedAt: now },
      });
    await appendAuditEvent(tx, {
      eventType: 'TRAVELLER_PLAN_THRESHOLDS_CHANGED',
      actorAccountId: staff.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'traveller_plan_health_settings',
      resourceId: null,
      metadata: {
        before: { ...before, available: undefined, updatedAt: undefined },
        after: values,
      },
    });
    return ok({ settings: await readThresholds(tx), changed: true });
  });
}

export type TravellerSignalStatus = 'ok' | 'attention' | 'no_data';

export interface TravellerHealthSignal {
  readonly key: 'checkout_success' | 'confirmation_time' | 'stuck_confirming' | 'needs_check';
  /** The measured value: a percent, minutes, or a count; null with nothing to measure. */
  readonly value: number | null;
  readonly threshold: number;
  readonly status: TravellerSignalStatus;
}

export interface TravellerHealth {
  readonly signals: readonly TravellerHealthSignal[];
  readonly thresholds: TravellerHealthSettings;
}

/** The four health signals for traveller payments, each against its threshold, for the owner. */
export async function travellerPlanHealth(
  db: Db,
  staff: StaffScope<'PLANS_MANAGE'>,
  input: { readonly now?: Date } = {},
): Promise<Result<TravellerHealth, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const thresholds = await readThresholds(db);
  const now = input.now ?? new Date();
  let success: number | null = null;
  let minutes: number | null = null;
  let stuck = 0;
  let needsCheck = 0;
  if (await personBillingPresent(db)) {
    const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const stuckSince = new Date(now.getTime() - STUCK_AFTER_MS).toISOString();
    const [row] = rowsOf<{
      finished: number | string;
      paid: number | string;
      median_minutes: number | string | null;
      stuck: number | string;
      held: number | string;
    }>(
      await db.execute(sql`
        select
          count(*) filter (where a.created_at >= ${dayAgo}::timestamptz
            and a.status in ('RECORDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'HELD_FOR_REVIEW', 'REFUNDED'))::int as finished,
          count(*) filter (where a.created_at >= ${dayAgo}::timestamptz and a.status in ('RECORDED', 'REFUNDED'))::int as paid,
          percentile_cont(0.5) within group (order by extract(epoch from (a.recorded_at - coalesce(a.redirected_at, a.created_at))) / 60)
            filter (where a.status = 'RECORDED' and a.recorded_at >= ${weekAgo}::timestamptz) as median_minutes,
          count(*) filter (where a.status in ('REDIRECTED', 'VALIDATED') and a.created_at < ${stuckSince}::timestamptz
            and a.created_at >= ${weekAgo}::timestamptz)::int as stuck,
          count(*) filter (where a.status = 'HELD_FOR_REVIEW')::int as held
        from payment_attempts a
        where a.payer_account_id is not null and a.mode = 'LIVE'`),
    );
    if (row) {
      const finished = Number(row.finished);
      success = finished > 0 ? Math.round((Number(row.paid) / finished) * 100) : null;
      minutes = row.median_minutes === null ? null : Math.round(Number(row.median_minutes));
      stuck = Number(row.stuck);
      needsCheck = Number(row.held);
    }
  }
  const signals: TravellerHealthSignal[] = [
    {
      key: 'checkout_success',
      value: success,
      threshold: thresholds.checkoutSuccessMinPercent,
      status:
        success === null
          ? 'no_data'
          : success < thresholds.checkoutSuccessMinPercent
            ? 'attention'
            : 'ok',
    },
    {
      key: 'confirmation_time',
      value: minutes,
      threshold: thresholds.confirmationMaxMinutes,
      status:
        minutes === null
          ? 'no_data'
          : minutes > thresholds.confirmationMaxMinutes
            ? 'attention'
            : 'ok',
    },
    {
      key: 'stuck_confirming',
      value: stuck,
      threshold: thresholds.stuckConfirmingMax,
      status: stuck > thresholds.stuckConfirmingMax ? 'attention' : 'ok',
    },
    {
      key: 'needs_check',
      value: needsCheck,
      threshold: thresholds.needsCheckMax,
      status: needsCheck > thresholds.needsCheckMax ? 'attention' : 'ok',
    },
  ];
  return ok({ signals, thresholds });
}
