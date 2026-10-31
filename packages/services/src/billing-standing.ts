import { BILLING_CALENDAR_TIME_ZONE, billingDaysUntil } from '@visastack/core';
import { type SQL, and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  type BillingStatus,
  type BillingStatusCause,
  type NewestBillingStatusChange,
  newestBillingStatusChange,
} from './billing-history';
import { type Db, first, schema } from './db';
import { toLocalDateParts } from './notification-sweep';

/**
 * What the daily billing run, the payment path and the Billing Rules preview all need to judge
 * one agency's billing standing the same way (S17, ADR 0020 Phase 2): the billing calendar, what
 * "overdue" means, the one overlap rule for invoice periods, and the locked read of a billing
 * account. Reads only; the writes live with the recording function (`invoice-ledger.ts`).
 *
 * Lock order, everywhere a billing status can change or an invoice is created: the invoice row
 * (payments only), then the billing account row (`lockBillingAccount`), then the audit chain (the
 * first `appendAuditEvent`). Nothing that holds the audit chain ever waits for a billing account
 * row. Invoice creation (by hand or by the run) is serialised per agency on the billing account
 * row, and a payment always takes it before deciding anything from the account's status.
 */

/** The calendar billing days are counted in. */
export const BILLING_TIME_ZONE = BILLING_CALENDAR_TIME_ZONE;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole Bangladesh calendar days from the due date to `now`: 0 on the due day, 1 the day after,
 * negative before it. A due date stored as UTC midnight of a day (how every invoice's due date is
 * stored) reads as that same day in Bangladesh.
 */
export function daysPastDue(dueDate: Date, now: Date): number {
  // The one day rule (S30): core's billingDaysUntil, which the invoice card's Overdue marker and
  // the invoice document's stamp use too, so the screens, the documents and the daily run agree.
  return 0 - billingDaysUntil(dueDate, now);
}

/** Overdue means from the Bangladesh day after the due date: the due day itself is not overdue. */
export function isOverdue(dueDate: Date, now: Date): boolean {
  return daysPastDue(dueDate, now) >= 1;
}

/**
 * UTC midnight of the Bangladesh calendar day of `at`, plus `days` days: how a due date is
 * stored, the same shape as one typed into the admin form, so every page and notice shows the
 * same day.
 */
export function billingDay(at: Date, days = 0): Date {
  const { year, month, day } = toLocalDateParts(at, BILLING_TIME_ZONE);
  return new Date(Date.UTC(year, month - 1, day + days));
}

/**
 * The one overlap rule for invoice periods, used by the daily run (to skip a period already
 * billed) and by an admin creating an invoice (to refuse billing a period twice): an invoice
 * whose period starts before `end` and ends after `start`. Periods that only touch do not overlap.
 */
export function invoicePeriodOverlaps(start: SQL, end: SQL): SQL {
  const i = schema.invoices;
  return sql`(${i.periodStart} < ${end} and ${i.periodEnd} > ${start})`;
}

/** A moment as a typed SQL value, for `invoicePeriodOverlaps`. */
export function timestampSql(at: Date): SQL {
  return sql`${at.toISOString()}::timestamptz`;
}

export interface BillingAccountRow {
  readonly id: string;
  readonly organizationId: string;
  readonly status: BillingStatus;
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
  /** Unpaid invoices that are overdue (`isOverdue`) at the moment judged. */
  readonly overdue: readonly OverdueInvoice[];
}

export interface AutomaticStatusChange {
  readonly toStatus: BillingStatus;
  readonly reason: string;
  /** The invoice that caused it, for a move to Grace or Suspended. */
  readonly invoice: OverdueInvoice | null;
  readonly daysOverdue: number | null;
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

/**
 * True for an invoice that has no refund in its ledger (S18, ADR 0020 S18 amendment D2). A
 * confirmed refund never makes an invoice owed again: an invoice with any `REFUND` row is left
 * out of every overdue judgement (status changes, the return to Active, the preview) and of
 * reminders. If money is genuinely owed again, staff issue a new invoice. The ledger exists since
 * migration 0094, before every caller's own migration (0103), so this never meets a missing table.
 */
export function invoiceNotRefundedSql(invoiceId: SQL): SQL {
  return sql`not ${invoiceHasRefundSql(invoiceId)}`;
}

/**
 * The one rule for "this invoice has a refund" (S18, D2): any `REFUND` row in its ledger. Every
 * place that asks (overdue, reminders, paying, reporting, recording money) uses this.
 */
export function invoiceHasRefundSql(invoiceId: SQL): SQL {
  const p = schema.invoicePayments;
  return sql`exists (select 1 from ${p} where ${p.invoiceId} = ${invoiceId} and ${p.kind} = 'REFUND')`;
}

/** Unpaid invoices of these organizations that are overdue at `now`. Refunded invoices are never overdue (D2). */
export async function overdueInvoices(
  db: Db,
  organizationIds: readonly string[],
  now: Date,
): Promise<Array<OverdueInvoice & { readonly organizationId: string }>> {
  if (organizationIds.length === 0) return [];
  const i = schema.invoices;
  // Every overdue invoice is due before `now` (its due day has ended); the exact day rule is
  // applied below.
  const rows = await db
    .select({
      organizationId: i.organizationId,
      invoiceId: i.id,
      invoiceRef: i.invoiceRef,
      dueDate: i.dueDate,
    })
    .from(i)
    .where(
      and(
        inArray(i.organizationId, [...organizationIds]),
        inArray(i.status, ['OPEN', 'PARTIALLY_PAID']),
        lt(i.dueDate, now),
        invoiceNotRefundedSql(sql`${i.id}`),
      ),
    );
  return rows.filter((row) => isOverdue(row.dueDate, now));
}

/**
 * The one shape of a standing, from the account, its newest history row and its overdue invoices
 * (as `overdueInvoices` returns them). Used by the locked read below and the run's batch read.
 */
export function toBillingStanding(
  account: BillingAccountRow,
  newest: NewestBillingStatusChange | undefined,
  overdue: readonly OverdueInvoice[],
): BillingStanding {
  return {
    status: account.status,
    cause: newest?.cause ?? 'MANUAL',
    changedAt: newest?.createdAt ?? null,
    overdue: overdue.map(({ invoiceId, invoiceRef, dueDate }) => ({
      invoiceId,
      invoiceRef,
      dueDate,
    })),
  };
}

/**
 * The billing account's standing at `now`, read inside the caller's transaction after its lock.
 * Only once migration 0103 is confirmed (the cause column is read directly).
 */
export async function readBillingStanding(
  tx: Db,
  account: BillingAccountRow,
  now: Date,
): Promise<BillingStanding> {
  return toBillingStanding(
    account,
    await newestBillingStatusChange(tx, account.id),
    await overdueInvoices(tx, [account.organizationId], now),
  );
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

/** One reading of the database clock. */
export async function databaseNow(db: Db): Promise<Date> {
  const rows = await db
    .select({ now: sql<string>`(extract(epoch from now()) * 1000)::bigint::text` })
    .from(sql`(select 1) as probe`);
  const ms = Number(rows[0]?.now);
  return Number.isFinite(ms) ? new Date(ms) : new Date();
}

/**
 * An agency's short code: the first 8 hex of its organization id, upper case. Used in run-made
 * invoice references (S17) and in the monthly accounting file (S18); organizations have no
 * reference code of their own.
 */
export function agencyCode(organizationId: string): string {
  return organizationId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** The agency's name, which every billing notice opens with (S30). Empty when it is missing. */
export async function agencyName(tx: Db, organizationId: string): Promise<string> {
  const row = first(
    await tx
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  );
  return row?.name.trim() ?? '';
}

/**
 * A billing notice's first line, naming the agency first (S30): "Dhaka Visa Desk: invoice
 * INV-7D3F9A2C-20261101 is due on 8 Nov 2026." Without a name it reads as the plain sentence.
 * Never an amount: billing notices and emails carry none.
 */
export function agencyLine(name: string, sentence: string): string {
  const trimmed = name.trim();
  if (!trimmed) return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
  return `${trimmed}: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
}

/** Where billing notices lead: the agency's Invoices page. */
export function invoicesPath(organizationId: string): string {
  return `/app/agency/${organizationId}/plan/invoices`;
}
