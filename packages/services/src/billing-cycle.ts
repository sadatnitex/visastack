import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { SystemScope } from './access/principal';
import { type AuditEventInput, appendAuditEvent } from './audit';
import {
  type BillingStatus,
  type BillingStatusCause,
  billingStatusCausePresent,
  insertBillingStatusHistory,
} from './billing-history';
import {
  type BillingSettings,
  billingSettingsPresent,
  getBillingSettings,
} from './billing-settings';
import { type Db, first, schema } from './db';
import { titleDate } from './naming';
import { localDateDiffInDays } from './notification-sweep';
import { type EnqueueNotificationInput, enqueueNotificationBothChannels } from './notifications';

/**
 * The daily billing run (S17, ADR 0020 Phase 2): `process-billing-cycle`.
 *
 * Three steps, each safe to run any number of times and after any gap:
 *
 * A. Invoices. For each agency whose current plan has a price above zero, whose organization is
 *    active and whose billing account is Active or in Grace, the invoice for the plan period
 *    running today is created once. Periods are whole multiples of the plan's period length from
 *    the subscription's start. Only the period running now is ever billed (a run that was down
 *    for three periods bills one), and never a period that started before billing rules existed
 *    (`invoicingStartsAt`). Billing the same period twice is impossible: a period overlapping any
 *    invoice for the same plan (void or not) is skipped, and the database refuses a second live
 *    invoice for the same organization, plan and period start, so two runs at once make one.
 * B. Reminders, to the agency's owners and admins: 3 days before the due date, on the due date,
 *    and 3 and 7 days after. Each is sent once (the notification key includes the stage) and only
 *    while it is the latest stage reached, so a missed day sends today's stage, never a backlog.
 * C. Status. Only when the owner has switched automatic Grace and Suspended on: an agency whose
 *    oldest unpaid invoice is `graceAfterDays` past due moves to Grace, and `suspendAfterDays`
 *    past due to Suspended. Always, even when switched off: an agency that VisaStack moved to
 *    Grace or Suspended and that now owes nothing overdue (an invoice was voided, say) returns to
 *    Active. A status a person set is never changed: the run acts only on Active (for debts that
 *    fell due after the person's last change) or on a Grace that VisaStack set itself.
 *
 * Calendar days are counted in Bangladesh time (`BILLING_TIME_ZONE`), from one reading of the
 * database clock. Each agency is handled in its own transaction: one failure is counted and the
 * run goes on. A run stops starting new work after `deadlineMs` or `limit` pieces of work, and
 * the next run carries on where it left off.
 *
 * Before migration 0103 the run reports `available: false` and changes nothing.
 */

/** The calendar billing days are counted in. */
export const BILLING_TIME_ZONE = 'Asia/Dhaka';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 200;
const DEFAULT_DEADLINE_MS = 40_000;

export type ReminderStage = 'before_3' | 'due_0' | 'overdue_3' | 'overdue_7';

/**
 * The reminder stage reached `daysUntilDue` calendar days before the due date (negative once it
 * has passed), or null. A stage lasts until the next one begins, so a run that missed a day still
 * sends the stage that is current, and nothing is sent once the last stage has ended (day 13).
 */
export function reminderStage(daysUntilDue: number): ReminderStage | null {
  if (daysUntilDue > 3) return null;
  if (daysUntilDue >= 1) return 'before_3';
  if (daysUntilDue >= -2) return 'due_0';
  if (daysUntilDue >= -6) return 'overdue_3';
  if (daysUntilDue >= -13) return 'overdue_7';
  return null;
}

/** INV-<first 8 hex of the organization id>-<period start as YYYYMMDD in Bangladesh time>. */
export function cycleInvoiceRef(organizationId: string, periodStart: Date): string {
  const org = organizationId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(periodStart)
    .replace(/-/g, '');
  return `INV-${org}-${day}`;
}

export interface OverduePolicy {
  readonly graceAfterDays: number;
  readonly suspendAfterDays: number;
}

export interface OverdueInvoice {
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly dueDate: Date;
}

export interface BillingStanding {
  readonly status: BillingStatus;
  /** What set the current status: the cause on the newest history row. */
  readonly cause: BillingStatusCause;
  /** When the current status was set (the newest history row), or null without history. */
  readonly changedAt: Date | null;
  /** Unpaid invoices whose due date has passed. */
  readonly overdue: readonly OverdueInvoice[];
}

export interface AutomaticStatusChange {
  readonly toStatus: BillingStatus;
  readonly reason: string;
  /** The invoice that caused it, for a move to Grace or Suspended. */
  readonly invoice: OverdueInvoice | null;
  readonly daysOverdue: number | null;
}

/**
 * The status change the run would make for one billing account, or null. Pure, so the run, the
 * Billing Rules preview and the payment path judge an agency by exactly the same rule.
 */
export function automaticStatusChange(
  standing: BillingStanding,
  policy: OverduePolicy | null,
  now: Date,
): AutomaticStatusChange | null {
  const setByVisaStack = standing.cause === 'NONPAYMENT';
  if (standing.overdue.length === 0) {
    if (setByVisaStack && (standing.status === 'GRACE' || standing.status === 'SUSPENDED')) {
      return {
        toStatus: 'ACTIVE',
        reason: 'system: no overdue invoices',
        invoice: null,
        daysOverdue: null,
      };
    }
    return null;
  }
  if (policy === null) return null;
  const movable = standing.status === 'ACTIVE' || (standing.status === 'GRACE' && setByVisaStack);
  if (!movable) return null;
  // A person's last change covers what was already overdue when they made it.
  const relevant = setByVisaStack
    ? standing.overdue
    : standing.overdue.filter(
        (invoice) =>
          standing.changedAt === null || invoice.dueDate.getTime() >= standing.changedAt.getTime(),
      );
  const oldest = [...relevant].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  if (!oldest) return null;
  const days = localDateDiffInDays(oldest.dueDate, now, BILLING_TIME_ZONE);
  const toStatus: BillingStatus | null =
    days >= policy.suspendAfterDays
      ? 'SUSPENDED'
      : days >= policy.graceAfterDays && standing.status === 'ACTIVE'
        ? 'GRACE'
        : null;
  if (toStatus === null || toStatus === standing.status) return null;
  return {
    toStatus,
    reason: `system: overdue ${days} days (${oldest.invoiceRef})`,
    invoice: oldest,
    daysOverdue: days,
  };
}

function policyOf(settings: BillingSettings): OverduePolicy | null {
  if (
    !settings.overdueHandlingEnabled ||
    settings.graceAfterDays === null ||
    settings.suspendAfterDays === null
  ) {
    return null;
  }
  return { graceAfterDays: settings.graceAfterDays, suspendAfterDays: settings.suspendAfterDays };
}

function rowsOf<T>(result: unknown): T[] {
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows;
  return (rows ?? []) as T[];
}

/** Whether migration 0103 is in place: the rules table, the history cause and the period index. */
async function cycleAvailable(db: Db): Promise<boolean> {
  if (!(await billingSettingsPresent(db))) return false;
  if (!(await billingStatusCausePresent(db))) return false;
  const rows = await db
    .select({
      present: sql<boolean>`to_regclass('invoices_org_plan_period_unique') is not null`,
    })
    .from(sql`(select 1) as probe`);
  return rows[0]?.present === true;
}

/** The agency's owners and admins: who billing notices go to (checked again when sending). */
export async function billingContacts(tx: Db, organizationId: string): Promise<string[]> {
  const rows = await tx
    .select({ accountId: schema.memberships.accountId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        inArray(schema.memberships.role, ['OWNER', 'ADMIN']),
        eq(schema.memberships.active, true),
      ),
    )
    .orderBy(asc(schema.memberships.accountId));
  return rows.map((row) => row.accountId);
}

function invoicesPath(organizationId: string): string {
  return `/app/agency/${organizationId}/plan/invoices`;
}

// --- Status changes made by VisaStack -------------------------------------------------------

const STATUS_NOTICE: Readonly<
  Partial<Record<BillingStatus, (ref: string, days: number | null) => string>>
> = {
  GRACE: (ref, days) =>
    `Invoice ${ref} is ${days ?? 0} days past its due date. Everything still works for now. Paying it keeps your agency from being suspended.`,
  SUSPENDED: (ref, days) =>
    `Invoice ${ref} is ${days ?? 0} days past its due date. Adding cases, team members and files is paused until it is paid. Nothing is deleted or hidden.`,
  ACTIVE: () => 'No invoice is overdue now, so your agency is back to Active.',
};

const STATUS_SUBJECT: Readonly<Partial<Record<BillingStatus, string>>> = {
  GRACE: 'Your agency is in Grace',
  SUSPENDED: 'Your agency is suspended',
  ACTIVE: 'Your agency is active again',
};

export interface BillingAccountRow {
  readonly id: string;
  readonly organizationId: string;
  readonly status: BillingStatus;
}

/**
 * The billing part of one status change VisaStack made: the account's new status and a history
 * row with no person (cause NONPAYMENT, reason starting "system:"). The caller holds the billing
 * account's row lock, has checked the change is still right, and writes `systemStatusAudit` and
 * `systemStatusNotice` in the same transaction.
 */
export async function recordSystemStatusChange(
  tx: Db,
  account: BillingAccountRow,
  change: AutomaticStatusChange,
): Promise<void> {
  await tx
    .update(schema.billingAccounts)
    .set({ status: change.toStatus, updatedAt: new Date() })
    .where(eq(schema.billingAccounts.id, account.id));
  await insertBillingStatusHistory(tx, {
    billingAccountId: account.id,
    fromStatus: account.status,
    toStatus: change.toStatus,
    actorAccountId: null,
    reason: change.reason,
    cause: 'NONPAYMENT',
  });
}

/** The audit record of a status change VisaStack made (no person, method SYSTEM). */
export function systemStatusAudit(
  account: BillingAccountRow,
  change: AutomaticStatusChange,
): AuditEventInput {
  return {
    eventType: 'BILLING_STATUS_CHANGED',
    actorAccountId: null,
    action: 'MANAGE',
    method: 'SYSTEM',
    result: 'ALLOWED',
    resourceType: 'billing_account',
    resourceId: account.id,
    reason: change.reason,
    metadata: {
      organizationId: account.organizationId,
      fromStatus: account.status,
      toStatus: change.toStatus,
      cause: 'NONPAYMENT',
      invoiceId: change.invoice?.invoiceId ?? null,
    },
  };
}

/**
 * The notice to the agency's owners and admins about a status change VisaStack made: one per
 * change (`noticeKey` tells changes apart), naming the invoice and how late it is, never an
 * amount.
 */
export function systemStatusNotice(
  account: BillingAccountRow,
  change: AutomaticStatusChange,
  noticeKey: string,
): Omit<EnqueueNotificationInput, 'channel' | 'recipientAccountId'> | null {
  const summary = STATUS_NOTICE[change.toStatus]?.(
    change.invoice?.invoiceRef ?? '',
    change.daysOverdue,
  );
  const subject = STATUS_SUBJECT[change.toStatus];
  if (!summary || !subject) return null;
  return {
    eventType: 'BILLING_STATUS_CHANGED',
    resourceId: account.id,
    organizationId: account.organizationId,
    threshold: `${change.toStatus}:${noticeKey}`,
    payload: { subject, summary, deepLinkPath: invoicesPath(account.organizationId) },
  };
}

/** The job's own write of a status change: the billing part, the audit record and the notices. */
async function applySystemStatusChange(
  tx: Db,
  account: BillingAccountRow,
  change: AutomaticStatusChange,
  noticeKey: string,
): Promise<void> {
  await recordSystemStatusChange(tx, account, change);
  await appendAuditEvent(tx, systemStatusAudit(account, change));
  const notice = systemStatusNotice(account, change, noticeKey);
  if (!notice) return;
  for (const recipientAccountId of await billingContacts(tx, account.organizationId)) {
    await enqueueNotificationBothChannels(tx, { ...notice, recipientAccountId });
  }
}

/**
 * The billing account's standing, read inside the caller's transaction (after its lock).
 * Overdue means due before `now`, or before the database clock when `now` is null.
 */
export async function readBillingStanding(
  tx: Db,
  account: BillingAccountRow,
  now: Date | null,
): Promise<BillingStanding> {
  const h = schema.billingStatusHistory;
  const newest = first(
    await tx
      .select({ createdAt: h.createdAt, cause: sql<string | null>`to_jsonb(${h}) ->> 'cause'` })
      .from(h)
      .where(eq(h.billingAccountId, account.id))
      .orderBy(desc(h.createdAt))
      .limit(1),
  );
  const i = schema.invoices;
  const overdue = await tx
    .select({ invoiceId: i.id, invoiceRef: i.invoiceRef, dueDate: i.dueDate })
    .from(i)
    .where(
      and(
        eq(i.organizationId, account.organizationId),
        inArray(i.status, ['OPEN', 'PARTIALLY_PAID']),
        now === null ? lt(i.dueDate, sql`now()`) : lt(i.dueDate, now),
      ),
    );
  return {
    status: account.status,
    cause: newest?.cause === 'NONPAYMENT' ? 'NONPAYMENT' : 'MANUAL',
    changedAt: newest?.createdAt ?? null,
    overdue,
  };
}

/** The organization's billing account, locked for the rest of the caller's transaction. */
export async function lockBillingAccount(
  tx: Db,
  organizationId: string,
): Promise<BillingAccountRow | undefined> {
  return first(
    await tx
      .select({
        id: schema.billingAccounts.id,
        organizationId: schema.billingAccounts.organizationId,
        status: schema.billingAccounts.status,
      })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)
      .for('update'),
  );
}

// --- The run -----------------------------------------------------------------------------

export interface BillingCycleSummary {
  /** False before migration 0103: nothing was looked at or changed. */
  readonly available: boolean;
  readonly overdueHandlingEnabled: boolean;
  readonly invoicesCreated: number;
  /** Invoices a reminder was queued for (to each owner and admin, in the app and by email). */
  readonly remindersQueued: number;
  readonly movedToGrace: number;
  readonly movedToSuspended: number;
  readonly returnedToActive: number;
  /** Pieces of work that failed; each was rolled back and is tried again next run. */
  readonly failed: number;
  /** True when the run stopped at its time or work limit with work left for the next run. */
  readonly stoppedEarly: boolean;
}

export interface RunBillingCycleOptions {
  /** The run's clock. Defaults to one reading of the database clock. */
  readonly now?: Date;
  /** Most pieces of work one run starts (default 200). */
  readonly limit?: number;
  /** Stop starting new work after this long (default 40 seconds). */
  readonly deadlineMs?: number;
}

interface Budget {
  readonly take: () => boolean;
  stoppedEarly: boolean;
}

function makeBudget(limit: number, deadlineMs: number): Budget {
  const startedAt = Date.now();
  let used = 0;
  const budget: Budget = {
    stoppedEarly: false,
    take: () => {
      if (used >= limit || Date.now() - startedAt > deadlineMs) {
        budget.stoppedEarly = true;
        return false;
      }
      used++;
      return true;
    },
  };
  return budget;
}

interface InvoiceCandidate {
  readonly organization_id: string;
  readonly plan_id: string;
  readonly price_minor_units: number;
  readonly currency: string;
  readonly period_days: number;
  readonly period_start_ms: string;
}

async function invoiceCandidates(db: Db, now: Date, limit: number): Promise<InvoiceCandidate[]> {
  const at = now.toISOString();
  return rowsOf<InvoiceCandidate>(
    await db.execute(sql`
      with rules as (select invoicing_starts_at from billing_settings where id),
      current_periods as (
        select s.organization_id, s.plan_id, p.price_minor_units, p.currency, p.period_days,
          date_trunc('milliseconds', s.started_at) + make_interval(secs => (
            floor(extract(epoch from (${at}::timestamptz - date_trunc('milliseconds', s.started_at)))
              / (p.period_days * 86400.0)) * p.period_days * 86400
          )::double precision) as period_start
        from subscriptions s
        join plans p on p.id = s.plan_id
        join organizations o on o.id = s.organization_id
        join billing_accounts b on b.organization_id = s.organization_id
        where s.ended_at is null
          and s.started_at <= ${at}::timestamptz
          and p.price_minor_units > 0
          and p.currency is not null
          and p.period_days > 0
          and o.status = 'ACTIVE'
          and b.status in ('ACTIVE', 'GRACE')
      )
      select c.organization_id, c.plan_id, c.price_minor_units, c.currency, c.period_days,
        (extract(epoch from c.period_start) * 1000)::bigint::text as period_start_ms
      from current_periods c, rules r
      where c.period_start >= r.invoicing_starts_at
        and not exists (
          select 1 from invoices i
          where i.organization_id = c.organization_id
            and i.plan_id = c.plan_id
            and i.period_start < c.period_start + make_interval(secs => (c.period_days * 86400)::double precision)
            and i.period_end > c.period_start
        )
      order by c.organization_id
      limit ${limit}
    `),
  );
}

/** Creates one period's invoice and its notice in one transaction. True when this call made it. */
async function createCycleInvoice(
  db: Db,
  candidate: InvoiceCandidate,
  dueDays: number,
): Promise<boolean> {
  const periodStart = new Date(Number(candidate.period_start_ms));
  const periodEnd = new Date(periodStart.getTime() + candidate.period_days * DAY_MS);
  const dueDate = new Date(periodStart.getTime() + dueDays * DAY_MS);
  const currency = candidate.currency.trim().toUpperCase();
  const base = cycleInvoiceRef(candidate.organization_id, periodStart);
  const i = schema.invoices;
  return db.transaction(async (tx) => {
    // The same reference can already exist (two plans starting the same day): add -2, -3 and on.
    const taken = new Set(
      (
        await tx
          .select({ ref: i.invoiceRef })
          .from(i)
          .where(sql`${i.invoiceRef} = ${base} or ${i.invoiceRef} like ${`${base}-%`}`)
      ).map((row) => row.ref),
    );
    for (let n = 1; n <= 20; n++) {
      const invoiceRef = n === 1 ? base : `${base}-${n}`;
      if (taken.has(invoiceRef)) continue;
      const inserted = first(
        await tx
          .insert(i)
          .values({
            organizationId: candidate.organization_id,
            planId: candidate.plan_id,
            periodStart,
            periodEnd,
            invoiceRef,
            invoicedAmountMinorUnits: candidate.price_minor_units,
            currency,
            dueDate,
          })
          .onConflictDoNothing()
          .returning({ id: i.id }),
      );
      if (!inserted) {
        // Either another run billed this period an instant ago (nothing more to do) or another
        // invoice took this reference (try the next one).
        const billed = first(
          await tx
            .select({ id: i.id })
            .from(i)
            .where(
              and(
                eq(i.organizationId, candidate.organization_id),
                eq(i.planId, candidate.plan_id),
                eq(i.periodStart, periodStart),
                sql`${i.status} <> 'VOID'`,
              ),
            )
            .limit(1),
        );
        if (billed) return false;
        taken.add(invoiceRef);
        continue;
      }
      await appendAuditEvent(tx, {
        eventType: 'INVOICE_CREATED',
        actorAccountId: null,
        action: 'MANAGE',
        method: 'SYSTEM',
        result: 'ALLOWED',
        resourceType: 'invoice',
        resourceId: inserted.id,
        reason: 'system: billing period',
        metadata: {
          organizationId: candidate.organization_id,
          invoiceRef,
          invoicedAmountMinorUnits: candidate.price_minor_units,
          currency,
          periodStart: periodStart.toISOString(),
        },
      });
      const due = titleDate(dueDate, BILLING_TIME_ZONE);
      for (const accountId of await billingContacts(tx, candidate.organization_id)) {
        await enqueueNotificationBothChannels(tx, {
          eventType: 'INVOICE_ISSUED',
          resourceId: inserted.id,
          recipientAccountId: accountId,
          organizationId: candidate.organization_id,
          payload: {
            subject: 'New invoice',
            summary: `Invoice ${invoiceRef} is ready. It is due on ${due}.`,
            deepLinkPath: invoicesPath(candidate.organization_id),
          },
        });
      }
      return true;
    }
    throw new Error('no free invoice reference for this period');
  });
}

const REMINDER_SUBJECT: Readonly<Record<ReminderStage, string>> = {
  before_3: 'Invoice due soon',
  due_0: 'Invoice due today',
  overdue_3: 'Invoice overdue',
  overdue_7: 'Invoice overdue',
};

function reminderTiming(stage: ReminderStage): 'upcoming' | 'today' | 'overdue' {
  if (stage === 'before_3') return 'upcoming';
  if (stage === 'due_0') return 'today';
  return 'overdue';
}

function reminderSummary(stage: ReminderStage, ref: string, due: string, days: number): string {
  if (stage === 'before_3') return `Invoice ${ref} is due on ${due}.`;
  if (stage === 'due_0') {
    return days === 0
      ? `Invoice ${ref} is due today, ${due}.`
      : `Invoice ${ref} was due on ${due}.`;
  }
  return `Invoice ${ref} was due on ${due} and is still unpaid.`;
}

async function queueReminders(
  db: Db,
  now: Date,
  budget: Budget,
): Promise<{ queued: number; failed: number }> {
  const i = schema.invoices;
  const o = schema.organizations;
  const open = await db
    .select({
      id: i.id,
      organizationId: i.organizationId,
      invoiceRef: i.invoiceRef,
      dueDate: i.dueDate,
    })
    .from(i)
    .innerJoin(o, eq(o.id, i.organizationId))
    .where(
      and(
        inArray(i.status, ['OPEN', 'PARTIALLY_PAID']),
        gte(i.dueDate, new Date(now.getTime() - 15 * DAY_MS)),
        lte(i.dueDate, new Date(now.getTime() + 5 * DAY_MS)),
        eq(o.status, 'ACTIVE'),
      ),
    )
    .orderBy(asc(i.dueDate), asc(i.id));
  const due = open
    .map((invoice) => {
      const days = localDateDiffInDays(now, invoice.dueDate, BILLING_TIME_ZONE);
      return { invoice, days, stage: reminderStage(days) };
    })
    .filter(
      (entry): entry is { invoice: (typeof open)[number]; days: number; stage: ReminderStage } =>
        entry.stage !== null,
    );
  if (due.length === 0) return { queued: 0, failed: 0 };
  // Stages already queued are skipped up front, so the work limit is spent only on new ones.
  const n = schema.notifications;
  const sent = new Set(
    (
      await db
        .select({ resourceId: n.resourceId, key: n.idempotencyKey })
        .from(n)
        .where(
          and(
            eq(n.eventType, 'INVOICE_REMINDER'),
            inArray(
              n.resourceId,
              due.map((entry) => entry.invoice.id),
            ),
          ),
        )
    ).map((row) => `${row.resourceId}:${row.key.split(':').at(-1) ?? ''}`),
  );
  let queued = 0;
  let failed = 0;
  for (const { invoice, days, stage } of due) {
    if (sent.has(`${invoice.id}:${stage}`)) continue;
    if (!budget.take()) break;
    try {
      await db.transaction(async (tx) => {
        const dueDay = titleDate(invoice.dueDate, BILLING_TIME_ZONE);
        for (const accountId of await billingContacts(tx, invoice.organizationId)) {
          await enqueueNotificationBothChannels(tx, {
            eventType: 'INVOICE_REMINDER',
            resourceId: invoice.id,
            recipientAccountId: accountId,
            organizationId: invoice.organizationId,
            threshold: stage,
            payload: {
              subject: REMINDER_SUBJECT[stage],
              summary: reminderSummary(stage, invoice.invoiceRef, dueDay, days),
              deepLinkPath: invoicesPath(invoice.organizationId),
              timing: reminderTiming(stage),
            },
          });
        }
      });
      queued++;
    } catch {
      failed++;
    }
  }
  return { queued, failed };
}

/** Every billing account the run could move, with its standing as of `now`, read without locks. */
async function standings(
  db: Db,
  now: Date,
): Promise<Array<{ account: BillingAccountRow; standing: BillingStanding }>> {
  const b = schema.billingAccounts;
  const o = schema.organizations;
  const accounts = await db
    .select({ id: b.id, organizationId: b.organizationId, status: b.status })
    .from(b)
    .innerJoin(o, eq(o.id, b.organizationId))
    .where(and(inArray(b.status, ['ACTIVE', 'GRACE', 'SUSPENDED']), eq(o.status, 'ACTIVE')))
    .orderBy(asc(b.organizationId));
  if (accounts.length === 0) return [];
  const h = schema.billingStatusHistory;
  const newest = await db
    .selectDistinctOn([h.billingAccountId], {
      billingAccountId: h.billingAccountId,
      createdAt: h.createdAt,
      cause: sql<string | null>`to_jsonb(${h}) ->> 'cause'`,
    })
    .from(h)
    .where(
      inArray(
        h.billingAccountId,
        accounts.map((account) => account.id),
      ),
    )
    .orderBy(h.billingAccountId, desc(h.createdAt));
  const newestByAccount = new Map(newest.map((row) => [row.billingAccountId, row]));
  const i = schema.invoices;
  const overdue = await db
    .select({
      organizationId: i.organizationId,
      invoiceId: i.id,
      invoiceRef: i.invoiceRef,
      dueDate: i.dueDate,
    })
    .from(i)
    .where(
      and(
        inArray(
          i.organizationId,
          accounts.map((account) => account.organizationId),
        ),
        inArray(i.status, ['OPEN', 'PARTIALLY_PAID']),
        lt(i.dueDate, now),
      ),
    );
  const overdueByOrg = new Map<string, OverdueInvoice[]>();
  for (const row of overdue) {
    const list = overdueByOrg.get(row.organizationId) ?? [];
    list.push({ invoiceId: row.invoiceId, invoiceRef: row.invoiceRef, dueDate: row.dueDate });
    overdueByOrg.set(row.organizationId, list);
  }
  return accounts.map((account) => {
    const last = newestByAccount.get(account.id);
    return {
      account,
      standing: {
        status: account.status,
        cause: last?.cause === 'NONPAYMENT' ? 'NONPAYMENT' : 'MANUAL',
        changedAt: last?.createdAt ?? null,
        overdue: overdueByOrg.get(account.organizationId) ?? [],
      },
    };
  });
}

export interface OverduePreview {
  readonly toGrace: number;
  readonly toSuspended: number;
}

/**
 * How many agencies switching automatic Grace and Suspended on with these day counts would move
 * at the next daily run, judged by the same rule the run uses. For the Billing Rules page, so
 * old unpaid invoices are seen before anything moves. Changes nothing.
 */
export async function previewOverdueHandling(
  db: Db,
  policy: OverduePolicy,
  now: Date = new Date(),
): Promise<OverduePreview> {
  if (!(await cycleAvailable(db))) return { toGrace: 0, toSuspended: 0 };
  let toGrace = 0;
  let toSuspended = 0;
  for (const { standing } of await standings(db, now)) {
    const change = automaticStatusChange(standing, policy, now);
    if (change?.toStatus === 'GRACE') toGrace++;
    if (change?.toStatus === 'SUSPENDED') toSuspended++;
  }
  return { toGrace, toSuspended };
}

const EMPTY: BillingCycleSummary = {
  available: false,
  overdueHandlingEnabled: false,
  invoicesCreated: 0,
  remindersQueued: 0,
  movedToGrace: 0,
  movedToSuspended: 0,
  returnedToActive: 0,
  failed: 0,
  stoppedEarly: false,
};

async function databaseNow(db: Db): Promise<Date> {
  const rows = await db
    .select({ now: sql<string>`(extract(epoch from now()) * 1000)::bigint::text` })
    .from(sql`(select 1) as probe`);
  const ms = Number(rows[0]?.now);
  return Number.isFinite(ms) ? new Date(ms) : new Date();
}

/** The daily billing run. See the module comment for what each step does. Counts only. */
export async function runBillingCycle(
  db: Db,
  scope: SystemScope<'process-billing-cycle'>,
  options: RunBillingCycleOptions = {},
): Promise<BillingCycleSummary> {
  if (scope.job !== 'process-billing-cycle') throw new Error('wrong job scope');
  if (!(await cycleAvailable(db))) return EMPTY;
  const settings = await getBillingSettings(db);
  if (!settings.available) return EMPTY;
  const now = options.now ?? (await databaseNow(db));
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT));
  const budget = makeBudget(limit, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const policy = policyOf(settings);
  let failed = 0;

  // A. One invoice per agency for the period running now.
  let invoicesCreated = 0;
  // One more than the budget, so a run that cannot finish says so.
  for (const candidate of await invoiceCandidates(db, now, limit + 1)) {
    if (!budget.take()) break;
    try {
      if (await createCycleInvoice(db, candidate, settings.dueDays)) invoicesCreated++;
    } catch {
      failed++;
    }
  }

  // B. Reminders for the stage each unpaid invoice has reached.
  const reminders = await queueReminders(db, now, budget);
  failed += reminders.failed;

  // C. Status: moves only when switched on; returns to Active always.
  let movedToGrace = 0;
  let movedToSuspended = 0;
  let returnedToActive = 0;
  for (const { account, standing } of await standings(db, now)) {
    if (automaticStatusChange(standing, policy, now) === null) continue;
    if (!budget.take()) break;
    try {
      const made = await db.transaction(async (tx) => {
        const locked = await lockBillingAccount(tx, account.organizationId);
        if (!locked) return null;
        // Judged again under the lock: a person may have changed it, or a payment arrived.
        const change = automaticStatusChange(
          await readBillingStanding(tx, locked, now),
          policy,
          now,
        );
        if (change === null) return null;
        await applySystemStatusChange(tx, locked, change, now.toISOString());
        return change.toStatus;
      });
      if (made === 'GRACE') movedToGrace++;
      else if (made === 'SUSPENDED') movedToSuspended++;
      else if (made === 'ACTIVE') returnedToActive++;
    } catch {
      failed++;
    }
  }

  return {
    available: true,
    overdueHandlingEnabled: policy !== null,
    invoicesCreated,
    remindersQueued: reminders.queued,
    movedToGrace,
    movedToSuspended,
    returnedToActive,
    failed,
    stoppedEarly: budget.stoppedEarly,
  };
}
