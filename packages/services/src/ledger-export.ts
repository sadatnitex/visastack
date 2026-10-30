import { type Result, csvCell, err, ok } from '@visastack/core';
import { utcToWallClock, wallClockToUtc } from '@visastack/core/calendar';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { StaffScope } from './access/principal';
import { staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { BILLING_TIME_ZONE, agencyCode } from './billing-standing';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { currencyDecimals } from './payment-amounts';

/**
 * The monthly accounting export (Small Commercial V1 S18, ADR 0020 Phase 2 "Accounting export"
 * and its S18 amendment). One CSV file of the cash ledger rows written in one Bangladesh calendar
 * month, for the platform owner's accountant.
 *
 * - The month is Bangladesh midnight on the 1st up to Bangladesh midnight on the next 1st, keyed on
 *   when each ledger row was written. The ledger is append-only, so a month's file never changes
 *   once the month is over.
 * - Ledger rows only: money held for a check and never counted is not in it (D3).
 * - Only the ledger, its invoices and the agencies are read: no traveller data can appear. The
 *   agency's name is business data and is included with its short code (D3).
 * - No formulas: every cell is quoted, quotes are doubled, and a cell whose first character after
 *   any spaces is `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so a
 *   spreadsheet shows it as text. Amounts are exact decimals without a sign (the direction column
 *   says IN or OUT), so no amount ever starts with a minus.
 * - Built in memory, at most 20,000 rows; a larger month is refused with a plain message.
 *
 * Platform owner only (`BILLING_LEDGER_EXPORT`, held by no other role, D1), with a fresh sign-in
 * check, and audited (the month and the row count).
 */

export const LEDGER_EXPORT_MAX_ROWS = 20_000;

/** The columns, in order. Nothing outside this list is ever written. */
export const LEDGER_CSV_COLUMNS = [
  'entry_id',
  'recorded_at_bd',
  'collected_date_bd',
  'invoice_ref',
  'agency_code',
  'agency_name',
  'kind',
  'direction',
  'amount',
  'currency',
  'provider',
  'provider_transaction_id',
  'reference',
  'refund_request_id',
  'recorded_by',
] as const;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** U+FEFF, written as the first character of the file (bytes EF BB BF in UTF-8). */
export const UTF8_BOM = String.fromCharCode(0xfeff);
/**
 * One CSV cell, safe to open in a spreadsheet: always quoted, quotes doubled, and an apostrophe in
 * front when the first character after leading spaces could start a formula. The rule is
 * `csvCell` in @visastack/core, shared with the account export (S21 round 3).
 */
export function ledgerCsvCell(value: string | number | null): string {
  return csvCell(value === null ? '' : String(value), { alwaysQuote: true });
}

/** An exact, unsigned decimal ("1500.00") from whole minor units, with the currency's own places. */
export function exactDecimal(minorUnits: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  const digits = String(Math.abs(Math.trunc(minorUnits)));
  if (decimals === 0) return digits;
  const padded = digits.padStart(decimals + 1, '0');
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

/** The UTC bounds of one Bangladesh calendar month, or null for text that is not `YYYY-MM`. */
export function ledgerMonthBounds(month: string): { start: Date; end: Date } | null {
  const match = month.trim().match(MONTH);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]);
  const nextYear = index === 12 ? year + 1 : year;
  const next = index === 12 ? 1 : index + 1;
  const start = wallClockToUtc(`${match[1]}-${match[2]}-01T00:00`, BILLING_TIME_ZONE);
  const end = wallClockToUtc(
    `${String(nextYear).padStart(4, '0')}-${String(next).padStart(2, '0')}-01T00:00`,
    BILLING_TIME_ZONE,
  );
  if (!start || !end) return null;
  return { start: new Date(start), end: new Date(end) };
}

function bdDateTime(at: Date): string {
  const wall = utcToWallClock(at.toISOString(), BILLING_TIME_ZONE);
  return wall ? `${wall.date} ${wall.time}` : '';
}

function bdDate(at: Date): string {
  return utcToWallClock(at.toISOString(), BILLING_TIME_ZONE)?.date ?? '';
}

export interface LedgerExportRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly collectedDate: Date;
  readonly invoiceRef: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly kind: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly provider: string | null;
  readonly providerTransactionId: string | null;
  readonly reference: string;
  readonly sourceId: string | null;
  readonly recordedByAccountId: string | null;
}

/** The whole file for a set of ledger rows: a header line and one line per row, CRLF line ends. */
export function ledgerCsv(rows: readonly LedgerExportRow[]): string {
  const lines = [LEDGER_CSV_COLUMNS.map((column) => ledgerCsvCell(column)).join(',')];
  for (const row of rows) {
    const refund = row.kind === 'REFUND';
    const cells: Record<(typeof LEDGER_CSV_COLUMNS)[number], string | number | null> = {
      entry_id: row.id,
      recorded_at_bd: bdDateTime(row.createdAt),
      collected_date_bd: bdDate(row.collectedDate),
      invoice_ref: row.invoiceRef,
      agency_code: agencyCode(row.organizationId),
      agency_name: row.organizationName,
      kind: row.kind,
      direction: row.amountMinorUnits < 0 ? 'OUT' : 'IN',
      amount: exactDecimal(row.amountMinorUnits, row.currency),
      currency: row.currency,
      provider: row.provider,
      provider_transaction_id: row.providerTransactionId,
      reference: row.reference,
      refund_request_id: refund ? row.sourceId : null,
      recorded_by: row.recordedByAccountId === null ? 'provider' : 'staff',
    };
    lines.push(LEDGER_CSV_COLUMNS.map((column) => ledgerCsvCell(cells[column])).join(','));
  }
  // A UTF-8 byte-order mark first, so Excel reads non-ASCII agency names (Bangla, accents) right.
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

export interface LedgerExport {
  readonly month: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly csv: string;
}

/**
 * The ledger rows of one Bangladesh calendar month as a CSV file. Refused for a month that is not
 * `YYYY-MM`, without a fresh sign-in check, or above the row cap.
 */
export async function exportLedgerMonth(
  db: Db,
  staff: StaffScope<'BILLING_LEDGER_EXPORT'>,
  input: { readonly month: string; readonly stepUpSatisfied: boolean },
): Promise<Result<LedgerExport, ServiceError>> {
  if (staffScopeProblem(staff, 'BILLING_LEDGER_EXPORT')) {
    return err(serviceError('forbidden', 'Only the platform owner can download the ledger.'));
  }
  const month = input.month.trim();
  const bounds = ledgerMonthBounds(month);
  if (!bounds) return err(serviceError('invalid', 'Choose a month.'));
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'downloading the ledger requires reauthentication'),
    );
  }
  const p = schema.invoicePayments;
  const i = schema.invoices;
  const o = schema.organizations;
  const rows = await db
    .select({
      id: p.id,
      createdAt: p.createdAt,
      collectedDate: p.collectedDate,
      invoiceRef: i.invoiceRef,
      organizationId: o.id,
      organizationName: o.name,
      kind: p.kind,
      amountMinorUnits: p.amountMinorUnits,
      currency: p.currency,
      provider: p.provider,
      providerTransactionId: p.providerTransactionId,
      reference: p.reference,
      sourceId: p.sourceId,
      recordedByAccountId: p.recordedByAccountId,
    })
    .from(p)
    .innerJoin(i, eq(i.id, p.invoiceId))
    .innerJoin(o, eq(o.id, i.organizationId))
    .where(and(gte(p.createdAt, bounds.start), lt(p.createdAt, bounds.end)))
    .orderBy(asc(p.seq))
    .limit(LEDGER_EXPORT_MAX_ROWS + 1);
  if (rows.length > LEDGER_EXPORT_MAX_ROWS) {
    return err(
      serviceError(
        'invalid',
        `This month has more than ${LEDGER_EXPORT_MAX_ROWS.toLocaleString('en-US')} ledger rows, more than one file can hold. Nothing was downloaded.`,
      ),
    );
  }
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'BILLING_LEDGER_EXPORTED',
      actorAccountId: staff.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'invoice_ledger',
      resourceId: null,
      metadata: { month, rowCount: rows.length },
    });
  });
  return ok({
    month,
    filename: `visastack-ledger-${month}.csv`,
    rowCount: rows.length,
    csv: ledgerCsv(rows),
  });
}
