import { type Result, dayCount, err, formatBillingDate, ok } from '@visastack/core';
import { type SQL, and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { type StaffScope, type SystemScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { billingStatusCausePresent } from './billing-history';
import {
  type BillingSettings,
  billingSettingsPresent,
  readBillingSettings,
} from './billing-settings';
import {
  type AutomaticStatusChange,
  BILLING_TIME_ZONE,
  type BillingAccountRow,
  type BillingStanding,
  DAY_MS,
  type OverdueInvoice,
  agencyCode,
  agencyLine,
  agencyName,
  billingContacts,
  billingDay,
  databaseNow,
  daysPastDue,
  invoiceNotRefundedSql,
  invoicePeriodOverlaps,
  invoicesPath,
  isOverdue,
  lockBillingAccount,
  overdueInvoices,
  readBillingStanding,
  timestampSql,
  toBillingStanding,
} from './billing-standing';
import { type Db, first, schema } from './db';
import { serverErrorEvent } from './error-report';
import type { ServiceError } from './errors';
import { applyOverdueStatusChange } from './invoice-ledger';
import { enqueueNotificationBothChannels } from './notifications';
import { formatObservabilityLine } from './observability-format';
import { entitlementsSchemaPresent } from './plans-schema';

export {
  type AutomaticStatusChange,
  BILLING_TIME_ZONE,
  type BillingStanding,
  type OverdueInvoice,
} from './billing-standing';

/**
 * The daily billing run (S17, ADR 0020 Phase 2): `process-billing-cycle`. Each step is safe to
 * run any number of times and after any gap, in this order:
 *
 * 1. Returns to Active. An agency that VisaStack moved to Grace or Suspended and that now owes
 *    nothing overdue returns to Active, always, even with automatic handling off.
 * 2. Invoices. For each agency whose plan has a price above zero, whose organization is active and
 *    whose billing account is Active or in Grace, the invoice for the plan period running now is
 *    created once. Periods are whole multiples of the plan's period length from the
 *    subscription's start. Only the period running now is billed, never one that started before
 *    the billing rules existed. Billing a period twice is impossible: creation is serialised per
 *    agency on its billing account row, a period overlapping any invoice for the same plan (void
 *    or not) is skipped under that lock, and the database refuses a second live invoice for the
 *    same organization, plan and period start. The due day is counted from the later of the
 *    period start and the moment the invoice is made, so an invoice is never born overdue.
 * 3. Moves, only when the owner has switched automatic Grace and Suspended on: an agency whose
 *    oldest overdue invoice is `graceAfterDays` days past its due day moves to Grace, and
 *    `suspendAfterDays` to Suspended. A status a person set is never changed: the run acts only on
 *    Active (for invoices that were not yet overdue when the person last changed it) or on a
 *    Grace VisaStack set. Invoices come first, so an agency moved in this run still gets the
 *    invoice for a period that began today.
 * 4. Reminders, to the agency's owners and admins: 3 days before the due day, on it, and 3 and 7
 *    days after. Each stage is sent once (the notification key includes it) and only while it is
 *    the latest stage reached. Agencies with no active owner or admin are left out (and logged
 *    once per run), so they never use up the reminder work limit.
 *
 * Days are Bangladesh calendar days (`BILLING_TIME_ZONE`); overdue means from the day after the
 * due day (`isOverdue`). One reading of the database clock. Each agency is handled in its own
 * transaction: one failure is logged, counted and rolled back, and the run goes on. Each step has
 * its own work limit, so no step crowds out another, and the run stops starting new work after
 * `deadlineMs`; the next run carries on.
 *
 * Before migration 0103 the run reports `available: false` and changes nothing.
 */

const DEFAULT_LIMIT = 200;
const DEFAULT_DEADLINE_MS = 40_000;

export type ReminderStage = 'before_3' | 'due_0' | 'overdue_3' | 'overdue_7';

/**
 * The reminder stage reached `daysUntilDue` calendar days before the due day (negative once it
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
  const org = agencyCode(organizationId);
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

/**
 * The due date of an invoice made at `issuedAt` for a period starting at `periodStart`: `dueDays`
 * Bangladesh days after the later of the two, stored as UTC midnight of that day.
 */
export function cycleDueDate(periodStart: Date, issuedAt: Date, dueDays: number): Date {
  const from = periodStart.getTime() > issuedAt.getTime() ? periodStart : issuedAt;
  return billingDay(from, dueDays);
}

export interface OverduePolicy {
  readonly graceAfterDays: number;
  readonly suspendAfterDays: number;
}

/**
 * The status change the run would make for one billing account, or null. Pure, so the run and the
 * Billing Rules preview judge an agency by exactly the same rule.
 */
/**
 * Whether VisaStack may move this account by itself: it is Active, or in a Grace that VisaStack
 * set. A status a person set (other than Active) and Suspended are never moved by the run.
 */
export function movableAutomatically(standing: BillingStanding): boolean {
  return (
    standing.status === 'ACTIVE' || (standing.status === 'GRACE' && standing.cause === 'NONPAYMENT')
  );
}

/**
 * Whether an overdue invoice counts towards an automatic move: a person's last change covers
 * every invoice that was already overdue when they made it (for example an extension).
 */
export function countedAutomatically(
  standing: BillingStanding,
  invoice: { readonly dueDate: Date },
): boolean {
  if (standing.cause === 'NONPAYMENT' || standing.changedAt === null) return true;
  return !isOverdue(invoice.dueDate, standing.changedAt);
}

/**
 * The day the run would move the agency to Suspended by itself, when that is really ahead: the
 * rules are on, the agency could be moved by the run (`movableAutomatically`), and the oldest
 * counted overdue invoice (`countedAutomatically`, the one `automaticStatusChange` judges by) has
 * not reached the day yet. `invoice` is the one the reminder is about; it counts too. Null
 * otherwise, so a reminder never warns about a pause that will not happen, or names a later day
 * than the run will use (S30).
 */
export function automaticSuspensionDay(
  standing: BillingStanding | null,
  policy: OverduePolicy | null,
  invoice: { readonly dueDate: Date },
  now: Date,
): Date | null {
  if (policy === null || standing === null) return null;
  if (!movableAutomatically(standing)) return null;
  const counted = [...standing.overdue, invoice].filter(
    (candidate) => isOverdue(candidate.dueDate, now) && countedAutomatically(standing, candidate),
  );
  const oldest = counted.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  if (!oldest) return null;
  if (daysPastDue(oldest.dueDate, now) >= policy.suspendAfterDays) return null;
  return billingDay(oldest.dueDate, policy.suspendAfterDays);
}

export function automaticStatusChange(
  standing: BillingStanding,
  policy: OverduePolicy | null,
  now: Date,
): AutomaticStatusChange | null {
  const setByVisaStack = standing.cause === 'NONPAYMENT';
  // `standing.overdue` holds only invoices overdue at `now` (`overdueInvoices`).
  const overdue = standing.overdue;
  if (overdue.length === 0) {
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
  if (!movableAutomatically(standing)) return null;
  const relevant = overdue.filter((invoice) => countedAutomatically(standing, invoice));
  const oldest = [...relevant].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  if (!oldest) return null;
  const days = daysPastDue(oldest.dueDate, now);
  const toStatus =
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

// --- Logging --------------------------------------------------------------------------------

type CycleStep = 'invoice' | 'reminder' | 'status' | 'return';

/**
 * One line per failure: the step, the organization, the invoice when there is one, and the
 * error's name and database code with its message cleaned by the shared server-error report (no
 * amounts, references or personal data are put in).
 */
function logFailure(
  step: CycleStep,
  error: unknown,
  ids: { readonly organizationId: string; readonly invoiceId?: string },
): void {
  console.error(
    formatObservabilityLine(
      serverErrorEvent('billingCycle', error, {
        step,
        organizationId: ids.organizationId,
        ...(ids.invoiceId ? { invoiceId: ids.invoiceId } : {}),
      }),
    ),
  );
}

/** Logs once per run that an agency has no active owner or admin to tell. */
function noContactLogger(): {
  readonly note: (organizationId: string) => void;
  size: () => number;
} {
  const seen = new Set<string>();
  return {
    note: (organizationId) => {
      if (seen.has(organizationId)) return;
      seen.add(organizationId);
      console.error(
        formatObservabilityLine({
          name: 'billing_cycle_no_contact',
          severity: 'warning',
          metadata: { reason: 'no_billing_contact', organizationId },
        }),
      );
    },
    size: () => seen.size,
  };
}

// --- The run -----------------------------------------------------------------------------

export interface BillingCycleSummary {
  /** False before migration 0103: nothing was looked at or changed. */
  readonly available: boolean;
  readonly overdueHandlingEnabled: boolean;
  readonly invoicesCreated: number;
  /** Invoices a reminder was written for (to at least one owner or admin). */
  readonly remindersQueued: number;
  readonly movedToGrace: number;
  readonly movedToSuspended: number;
  readonly returnedToActive: number;
  /** Agencies with no active owner or admin, so nobody could be told (logged once each). */
  readonly withoutContacts: number;
  /** Pieces of work that failed; each was logged, rolled back and is tried again next run. */
  readonly failed: number;
  /** True when the run stopped at a time or work limit with work left for the next run. */
  readonly stoppedEarly: boolean;
}

export interface RunBillingCycleOptions {
  /** The run's clock. Defaults to one reading of the database clock. */
  readonly now?: Date;
  /** Most pieces of work each step starts in one run (default 200). */
  readonly limit?: number;
  /** Stop starting new work after this long (default 40 seconds). */
  readonly deadlineMs?: number;
}

interface Budget {
  readonly take: () => boolean;
  readonly stopped: () => boolean;
}

/** One step's share of the run: its own work limit, and the run's shared deadline. */
function makeBudget(limit: number, deadline: () => boolean): Budget {
  let used = 0;
  let stopped = false;
  return {
    take: () => {
      if (used >= limit || deadline()) {
        stopped = true;
        return false;
      }
      used++;
      return true;
    },
    stopped: () => stopped,
  };
}

interface InvoiceCandidate {
  readonly organization_id: string;
  readonly plan_id: string;
  readonly price_minor_units: number;
  readonly currency: string;
  readonly period_days: number;
  readonly period_start_ms: string;
}

/**
 * Agencies whose current billing period has no invoice yet. S29: after migration 0107 the amount is
 * the plan's price in effect when that period started (`plan_prices`), so a price change applies
 * from each agency's next period and never to a period already under way. Before 0107 it is the
 * plan's own price, as before.
 */
async function invoiceCandidates(db: Db, now: Date, limit: number): Promise<InvoiceCandidate[]> {
  const at = now.toISOString();
  const priced = await entitlementsSchemaPresent(db);
  const price = priced
    ? sql`pr.price_minor_units, pr.currency`
    : sql`p.price_minor_units, p.currency`;
  const priceJoin = priced
    ? sql`cross join lateral (
          select pp.price_minor_units, pp.currency from plan_prices pp
          where pp.plan_id = s.plan_id
            and pp.effective_from <= date_trunc('milliseconds', s.started_at) + make_interval(secs => (
              floor(extract(epoch from (${at}::timestamptz - date_trunc('milliseconds', s.started_at)))
                / (nullif(p.period_days, 0) * 86400.0)) * p.period_days * 86400
            )::double precision)
          order by pp.effective_from desc
          limit 1
        ) pr`
    : sql``;
  const priceFilter = priced
    ? sql`pr.price_minor_units > 0 and pr.currency is not null`
    : sql`p.price_minor_units > 0 and p.currency is not null`;
  return rowsOf<InvoiceCandidate>(
    await db.execute(sql`
      with rules as (select invoicing_starts_at from billing_settings where id),
      current_periods as (
        select s.organization_id, s.plan_id, ${price}, p.period_days,
          date_trunc('milliseconds', s.started_at) + make_interval(secs => (
            floor(extract(epoch from (${at}::timestamptz - date_trunc('milliseconds', s.started_at)))
              / (p.period_days * 86400.0)) * p.period_days * 86400
          )::double precision) as period_start
        from subscriptions s
        join plans p on p.id = s.plan_id
        join organizations o on o.id = s.organization_id
        join billing_accounts b on b.organization_id = s.organization_id
        ${priceJoin}
        where s.ended_at is null
          and s.started_at <= ${at}::timestamptz
          and ${priceFilter}
          and p.period_days > 0
          and o.status = 'ACTIVE'
          and b.status in ('ACTIVE', 'GRACE')
      )
      select c.organization_id, c.plan_id, c.price_minor_units, c.currency, c.period_days,
        (extract(epoch from c.period_start) * 1000)::bigint::text as period_start_ms
      from current_periods c, rules r
      where c.period_start >= r.invoicing_starts_at
        and not exists (
          select 1 from invoices
          where invoices.organization_id = c.organization_id
            and invoices.plan_id = c.plan_id
            and ${invoicePeriodOverlaps(
              sql`c.period_start`,
              sql`c.period_start + make_interval(secs => (c.period_days * 86400)::double precision)`,
            )}
        )
      order by c.organization_id
      limit ${limit}
    `),
  );
}

/** Creates one period's invoice and its notices in one transaction. */
async function createCycleInvoice(
  db: Db,
  candidate: InvoiceCandidate,
  dueDays: number,
  now: Date,
): Promise<{ readonly created: boolean; readonly contacts: number | null }> {
  const periodStart = new Date(Number(candidate.period_start_ms));
  const periodEnd = new Date(periodStart.getTime() + candidate.period_days * DAY_MS);
  const dueDate = cycleDueDate(periodStart, now, dueDays);
  const currency = candidate.currency.trim().toUpperCase();
  const base = cycleInvoiceRef(candidate.organization_id, periodStart);
  const i = schema.invoices;
  return db.transaction(async (tx) => {
    // Invoice creation is serialised per agency on its billing account row (the same lock an admin
    // invoice takes, and the first lock in the order billing account, then audit chain): the
    // overlap check and the insert below cannot interleave with another invoice for this agency.
    const account = await lockBillingAccount(tx, candidate.organization_id);
    if (!account || (account.status !== 'ACTIVE' && account.status !== 'GRACE')) {
      return { created: false, contacts: null };
    }
    const overlapping = first(
      await tx
        .select({ id: i.id })
        .from(i)
        .where(
          and(
            eq(i.organizationId, candidate.organization_id),
            eq(i.planId, candidate.plan_id),
            invoicePeriodOverlaps(timestampSql(periodStart), timestampSql(periodEnd)),
          ),
        )
        .limit(1),
    );
    if (overlapping) return { created: false, contacts: null };
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
        if (billed) return { created: false, contacts: null };
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
      const due = formatBillingDate(dueDate, BILLING_TIME_ZONE);
      const contacts = await billingContacts(tx, candidate.organization_id);
      const name = await agencyName(tx, candidate.organization_id);
      for (const accountId of contacts) {
        await enqueueNotificationBothChannels(tx, {
          eventType: 'INVOICE_ISSUED',
          resourceId: inserted.id,
          recipientAccountId: accountId,
          organizationId: candidate.organization_id,
          payload: {
            subject: 'New Invoice',
            summary: agencyLine(name, `Invoice ${invoiceRef} is ready. It is due on ${due}.`),
            deepLinkPath: invoicesPath(candidate.organization_id),
          },
        });
      }
      return { created: true, contacts: contacts.length };
    }
    throw new Error('no free invoice reference for this period');
  });
}

interface ReminderWords {
  readonly subject: string;
  readonly summary: string;
  readonly timing: 'upcoming' | 'today' | 'overdue';
  /** The email's own heading when it differs from the standard one for its timing. */
  readonly heading?: string;
}

export interface ReminderContext {
  /** The agency's name, which the notice opens with. */
  readonly agencyName?: string;
  /** The reminder stage; the 7-day overdue reminder has its own words. */
  readonly stage?: ReminderStage;
  /**
   * The day an unpaid invoice would move the agency to Suspended, when automatic handling is on
   * and that day is still ahead ("8 Nov 2026"); the 7-day reminder says it, in neutral words.
   */
  readonly suspendsOn?: string | null;
}

/**
 * The words of a reminder from the actual day count: "due today" only on the due day itself;
 * after it, "was due on <day>". The 3-day and 7-day overdue reminders read differently, and the
 * 7-day one says what happens next when VisaStack moves unpaid agencies automatically. Every
 * reminder names the agency first and never an amount.
 */
export function reminderWords(
  daysUntilDue: number,
  ref: string,
  dueDay: string,
  context: ReminderContext = {},
): ReminderWords {
  const line = (sentence: string) => agencyLine(context.agencyName ?? '', sentence);
  if (daysUntilDue > 0) {
    return {
      subject: 'Invoice Due Soon',
      summary: line(`Invoice ${ref} is due on ${dueDay}.`),
      timing: 'upcoming',
    };
  }
  if (daysUntilDue === 0) {
    return {
      subject: 'Invoice Due Today',
      summary: line(`Invoice ${ref} is due today, ${dueDay}.`),
      timing: 'today',
    };
  }
  if (context.stage === 'overdue_7') {
    const next = context.suspendsOn
      ? ` If it is still unpaid on ${context.suspendsOn}, adding cases, team members and files will pause until it is paid. Nothing is deleted or hidden.`
      : '';
    return {
      subject: 'Invoice Still Overdue',
      summary: line(
        `Invoice ${ref} was due on ${dueDay} and is still unpaid ${dayCount(-daysUntilDue)} after its due date.${next}`,
      ),
      timing: 'overdue',
      heading: 'An invoice is still past its due date',
    };
  }
  return {
    subject: 'Invoice Overdue',
    summary: line(`Invoice ${ref} was due on ${dueDay} and is still unpaid.`),
    timing: 'overdue',
  };
}

/** Whether the organization has an active owner or admin, the people billing notices go to. */
function hasBillingContactSql(organizationId: SQL): SQL {
  const m = schema.memberships;
  return sql`exists (select 1 from ${m} where ${m.organizationId} = ${organizationId} and ${m.active} = true and ${m.role} in ('OWNER', 'ADMIN'))`;
}

/** An agency's billing standing at `now`, read without a lock (for reminder words only). */
async function standingOf(
  db: Db,
  organizationId: string,
  now: Date,
): Promise<BillingStanding | null> {
  const b = schema.billingAccounts;
  const account = first(
    await db
      .select({ id: b.id, organizationId: b.organizationId, status: b.status })
      .from(b)
      .where(eq(b.organizationId, organizationId))
      .limit(1),
  );
  return account ? readBillingStanding(db, account, now) : null;
}

async function queueReminders(
  db: Db,
  now: Date,
  budget: Budget,
  noContact: ReturnType<typeof noContactLogger>,
  policy: OverduePolicy | null,
): Promise<{ queued: number; failed: number }> {
  const i = schema.invoices;
  const o = schema.organizations;
  const open = await db
    .select({
      id: i.id,
      organizationId: i.organizationId,
      organizationName: o.name,
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
        hasBillingContactSql(sql`${i.organizationId}`),
        // S18 (D2): a refunded invoice is never chased again.
        invoiceNotRefundedSql(sql`${i.id}`),
      ),
    )
    .orderBy(asc(i.dueDate), asc(i.id));
  // Agencies left out because nobody can be told: one cheap read, logged once each per run.
  const unreachable = await db
    .selectDistinct({ organizationId: i.organizationId })
    .from(i)
    .innerJoin(o, eq(o.id, i.organizationId))
    .where(
      and(
        inArray(i.status, ['OPEN', 'PARTIALLY_PAID']),
        gte(i.dueDate, new Date(now.getTime() - 15 * DAY_MS)),
        lte(i.dueDate, new Date(now.getTime() + 5 * DAY_MS)),
        eq(o.status, 'ACTIVE'),
        sql`not ${hasBillingContactSql(sql`${i.organizationId}`)}`,
        invoiceNotRefundedSql(sql`${i.id}`),
      ),
    );
  for (const row of unreachable) noContact.note(row.organizationId);
  const due = open.flatMap((invoice) => {
    const daysUntilDue = -daysPastDue(invoice.dueDate, now);
    const stage = reminderStage(daysUntilDue);
    return stage === null ? [] : [{ invoice, daysUntilDue, stage }];
  });
  if (due.length === 0) return { queued: 0, failed: 0 };
  // Stages already written are skipped up front, so the work limit is spent only on new ones.
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
  for (const { invoice, daysUntilDue, stage } of due) {
    if (sent.has(`${invoice.id}:${stage}`)) continue;
    if (!budget.take()) break;
    try {
      const written = await db.transaction(async (tx) => {
        const contacts = await billingContacts(tx, invoice.organizationId);
        if (contacts.length === 0) return -1;
        // What happens next, only when VisaStack moves unpaid agencies automatically and the day
        // it would is still ahead.
        const suspendsOnDay =
          stage === 'overdue_7' && policy !== null
            ? automaticSuspensionDay(
                await standingOf(tx, invoice.organizationId, now),
                policy,
                invoice,
                now,
              )
            : null;
        const suspendsOn = suspendsOnDay ? formatBillingDate(suspendsOnDay) : null;
        const words = reminderWords(
          daysUntilDue,
          invoice.invoiceRef,
          formatBillingDate(invoice.dueDate, BILLING_TIME_ZONE),
          { agencyName: invoice.organizationName, stage, suspendsOn },
        );
        let rows = 0;
        for (const accountId of contacts) {
          rows += await enqueueNotificationBothChannels(tx, {
            eventType: 'INVOICE_REMINDER',
            resourceId: invoice.id,
            recipientAccountId: accountId,
            organizationId: invoice.organizationId,
            threshold: stage,
            payload: {
              subject: words.subject,
              summary: words.summary,
              deepLinkPath: invoicesPath(invoice.organizationId),
              timing: words.timing,
              ...(words.heading ? { heading: words.heading } : {}),
            },
          });
        }
        return rows;
      });
      if (written < 0) noContact.note(invoice.organizationId);
      else if (written > 0) queued++;
    } catch (error) {
      failed++;
      logFailure('reminder', error, {
        organizationId: invoice.organizationId,
        invoiceId: invoice.id,
      });
    }
  }
  return { queued, failed };
}

/** Every billing account the run could move, with its standing at `now`, read without locks. */
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
  // The newest history row of every account at once (the batch form of
  // `newestBillingStatusChange`); migration 0103 is confirmed, so the cause is read directly.
  const newest = await db
    .selectDistinctOn([h.billingAccountId], {
      billingAccountId: h.billingAccountId,
      createdAt: h.createdAt,
      cause: h.cause,
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
  const overdueByOrg = new Map<string, OverdueInvoice[]>();
  for (const row of await overdueInvoices(
    db,
    accounts.map((account) => account.organizationId),
    now,
  )) {
    const list = overdueByOrg.get(row.organizationId) ?? [];
    list.push(row);
    overdueByOrg.set(row.organizationId, list);
  }
  return accounts.map((account) => ({
    account,
    standing: toBillingStanding(
      account,
      newestByAccount.get(account.id),
      overdueByOrg.get(account.organizationId) ?? [],
    ),
  }));
}

export interface OverduePreview {
  readonly toGrace: number;
  readonly toSuspended: number;
}

async function countOverdueMoves(
  db: Db,
  policy: OverduePolicy,
  now: Date,
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

/**
 * How many agencies switching automatic Grace and Suspended on with these day counts would move
 * at the next daily run, judged by the same rule the run uses. For the platform owner's Billing
 * Rules page (totals only, a read: no fresh sign-in check). Changes nothing.
 */
export async function previewOverdueHandling(
  db: Db,
  staff: StaffScope<'BILLING_SETTINGS_MANAGE'>,
  policy: OverduePolicy,
  now?: Date,
): Promise<Result<OverduePreview, ServiceError>> {
  const denied = staffScopeProblem(staff, 'BILLING_SETTINGS_MANAGE');
  if (denied) return err(denied);
  return ok(await countOverdueMoves(db, policy, now ?? (await databaseNow(db))));
}

const EMPTY: BillingCycleSummary = {
  available: false,
  overdueHandlingEnabled: false,
  invoicesCreated: 0,
  remindersQueued: 0,
  movedToGrace: 0,
  movedToSuspended: 0,
  returnedToActive: 0,
  withoutContacts: 0,
  failed: 0,
  stoppedEarly: false,
};

/** The daily billing run. See the module comment for what each step does. Counts only. */
export async function runBillingCycle(
  db: Db,
  scope: SystemScope<'process-billing-cycle'>,
  options: RunBillingCycleOptions = {},
): Promise<BillingCycleSummary> {
  if (scope.job !== 'process-billing-cycle') throw new Error('wrong job scope');
  if (!(await cycleAvailable(db))) return EMPTY;
  const settings = await readBillingSettings(db);
  if (!settings.available) return EMPTY;
  const now = options.now ?? (await databaseNow(db));
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT));
  const startedAt = Date.now();
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const deadline = () => Date.now() - startedAt > deadlineMs;
  const policy = policyOf(settings);
  const noContact = noContactLogger();
  let failed = 0;

  let movedToGrace = 0;
  let movedToSuspended = 0;
  let returnedToActive = 0;
  /**
   * One status step: every account whose change is of this kind (a return to Active, or a move to
   * Grace or Suspended), each judged again under its billing account lock (the first lock in the
   * order billing account, then audit chain) and written in its own transaction.
   */
  const statusStep = async (kind: 'return' | 'move', budget: Budget) => {
    const isKind = (change: AutomaticStatusChange | null) =>
      change !== null && (change.toStatus === 'ACTIVE') === (kind === 'return');
    const planned = (await standings(db, now))
      .map(({ account, standing }) => ({
        account,
        change: automaticStatusChange(standing, policy, now),
      }))
      .filter((entry) => isKind(entry.change));
    for (const { account, change: first } of planned) {
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
          if (change === null || !isKind(change)) return null;
          const result = await applyOverdueStatusChange(
            tx,
            scope,
            locked,
            change,
            now.toISOString(),
          );
          if (result.contacts === 0) noContact.note(locked.organizationId);
          return change.toStatus;
        });
        if (made === 'GRACE') movedToGrace++;
        else if (made === 'SUSPENDED') movedToSuspended++;
        else if (made === 'ACTIVE') returnedToActive++;
      } catch (error) {
        failed++;
        logFailure(kind === 'return' ? 'return' : 'status', error, {
          organizationId: account.organizationId,
          ...(first?.invoice ? { invoiceId: first.invoice.invoiceId } : {}),
        });
      }
    }
  };

  // 1. Returns to Active, ahead of everything else, with their own budget.
  const returnBudget = makeBudget(limit, deadline);
  await statusStep('return', returnBudget);

  // 2. One invoice per agency for the period running now, before any move, so an agency moved to
  // Suspended in this run still gets the invoice for a period that began today (a new invoice is
  // never overdue, so the moves below are unaffected). One more than the budget is read, so a run
  // that cannot finish says so.
  const invoiceBudget = makeBudget(limit, deadline);
  let invoicesCreated = 0;
  for (const candidate of await invoiceCandidates(db, now, limit + 1)) {
    if (!invoiceBudget.take()) break;
    try {
      const made = await createCycleInvoice(db, candidate, settings.dueDays, now);
      if (made.created) invoicesCreated++;
      if (made.created && made.contacts === 0) noContact.note(candidate.organization_id);
    } catch (error) {
      failed++;
      logFailure('invoice', error, { organizationId: candidate.organization_id });
    }
  }

  // 3. Moves to Grace or Suspended, only when switched on, with their own budget.
  const moveBudget = makeBudget(limit, deadline);
  await statusStep('move', moveBudget);

  // 4. Reminders for the stage each unpaid invoice has reached.
  const reminderBudget = makeBudget(limit, deadline);
  const reminders = await queueReminders(db, now, reminderBudget, noContact, policy);
  failed += reminders.failed;

  return {
    available: true,
    overdueHandlingEnabled: policy !== null,
    invoicesCreated,
    remindersQueued: reminders.queued,
    movedToGrace,
    movedToSuspended,
    returnedToActive,
    withoutContacts: noContact.size(),
    failed,
    stoppedEarly:
      returnBudget.stopped() ||
      invoiceBudget.stopped() ||
      moveBudget.stopped() ||
      reminderBudget.stopped(),
  };
}
