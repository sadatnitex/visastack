import { asc, desc, eq, sql } from 'drizzle-orm';
import { type Db, first, schema } from './db';
import { clampLimit } from './paging';

/**
 * Billing status history rows, written and read so that they work both before and after
 * migration 0103 (S17, ADR 0020 Phase 2).
 *
 * 0103 adds a `cause` column (`MANUAL` for a person's change, `NONPAYMENT` for one the daily
 * billing run made) and lets the person be empty for the run's own rows. Drizzle names every
 * declared column in an insert or a plain select, so before 0103 a plain insert or select would
 * fail on the missing column. These helpers check the column first (a check that never raises,
 * so a surrounding transaction is never aborted) and, while it is missing, write and read only
 * the columns every database has. Before 0103 every row was written by a person, so every row
 * reads as `MANUAL`, which is exactly what it was.
 */

export type BillingStatus = (typeof schema.billingStatus.enumValues)[number];
export type BillingStatusCause = (typeof schema.billingStatusCause.enumValues)[number];
export type BillingStatusHistoryEntry = typeof schema.billingStatusHistory.$inferSelect;

/**
 * Handles already seen with the cause column. Only a "yes" is kept: migrations are additive, so a
 * column once present stays present, while a "no" must be asked again (the migration may run at
 * any moment). Keyed by the database or transaction handle, so one transaction asks once.
 */
const causeColumnSeen = new WeakMap<object, true>();

/** Whether migration 0103 has added the cause column. Never raises. */
export async function billingStatusCausePresent(db: Db): Promise<boolean> {
  if (causeColumnSeen.has(db)) return true;
  const rows = await db
    .select({
      present: sql<boolean>`exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'billing_status_history' and column_name = 'cause')`,
    })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) causeColumnSeen.set(db, true);
  return present;
}

export interface BillingStatusHistoryRow {
  readonly billingAccountId: string;
  readonly fromStatus: BillingStatus | null;
  readonly toStatus: BillingStatus;
  /** The person who made the change; null only for the daily billing run's own changes. */
  readonly actorAccountId: string | null;
  readonly reason: string;
  readonly cause: BillingStatusCause;
}

/**
 * Appends one history row, stamped with the moment it is written (not the start of its
 * transaction), so the newest row is always the last change made: every caller writes it after
 * updating the billing account row, which holds that row's lock until it commits. A change by the system (no person, cause `NONPAYMENT`) can only be
 * written once migration 0103 has run; every caller checks that first, so reaching it before is a
 * programmer fault and throws.
 */
export async function insertBillingStatusHistory(
  tx: Db,
  row: BillingStatusHistoryRow,
): Promise<void> {
  if (await billingStatusCausePresent(tx)) {
    await tx.insert(schema.billingStatusHistory).values({
      billingAccountId: row.billingAccountId,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorAccountId: row.actorAccountId,
      reason: row.reason,
      cause: row.cause,
      createdAt: sql`clock_timestamp()`,
    });
    return;
  }
  if (row.cause !== 'MANUAL' || row.actorAccountId === null) {
    throw new Error('an automatic billing status change needs migration 0103');
  }
  await tx.execute(
    sql`insert into billing_status_history (billing_account_id, from_status, to_status, actor_account_id, reason, created_at) values (${row.billingAccountId}, ${row.fromStatus}, ${row.toStatus}, ${row.actorAccountId}, ${row.reason}, clock_timestamp())`,
  );
}

/** The columns every database has, plus the cause read through the row as JSON (null before 0103). */
function historySelection() {
  const h = schema.billingStatusHistory;
  return {
    id: h.id,
    billingAccountId: h.billingAccountId,
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    actorAccountId: h.actorAccountId,
    reason: h.reason,
    createdAt: h.createdAt,
    cause: sql<string | null>`to_jsonb(${h}) ->> 'cause'`,
  };
}

function toEntry(row: {
  readonly id: string;
  readonly billingAccountId: string;
  readonly fromStatus: BillingStatus | null;
  readonly toStatus: BillingStatus;
  readonly actorAccountId: string | null;
  readonly reason: string;
  readonly createdAt: Date;
  readonly cause: string | null;
}): BillingStatusHistoryEntry {
  return { ...row, cause: row.cause === 'NONPAYMENT' ? 'NONPAYMENT' : 'MANUAL' };
}

/** Every history row of one billing account, newest first. */
export async function readBillingStatusHistory(
  db: Db,
  billingAccountId: string,
  options: { readonly limit?: number } = {},
): Promise<BillingStatusHistoryEntry[]> {
  const h = schema.billingStatusHistory;
  const query = db
    .select(historySelection())
    .from(h)
    .where(eq(h.billingAccountId, billingAccountId))
    .orderBy(desc(h.createdAt), asc(h.id));
  // WP-SB9: a page that shows only the newest changes reads only those (1 to 100 rows).
  const rows =
    options.limit === undefined ? await query : await query.limit(clampLimit(options.limit));
  return rows.map(toEntry);
}

export interface NewestBillingStatusChange {
  readonly cause: BillingStatusCause;
  /** When it was written. */
  readonly createdAt: Date;
}

/**
 * The newest history row of one billing account: what set its current status, and when. Only
 * after migration 0103 is confirmed (`billingStatusCausePresent`): it reads the cause column
 * directly. Undefined for an account without history.
 */
export async function newestBillingStatusChange(
  db: Db,
  billingAccountId: string,
): Promise<NewestBillingStatusChange | undefined> {
  const h = schema.billingStatusHistory;
  return first(
    await db
      .select({ cause: h.cause, createdAt: h.createdAt })
      .from(h)
      .where(eq(h.billingAccountId, billingAccountId))
      .orderBy(desc(h.createdAt))
      .limit(1),
  );
}
