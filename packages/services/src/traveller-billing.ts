import { type SQL, sql } from 'drizzle-orm';
import { invoiceHasRefundSql } from './billing-standing';
import type { Db } from './db';
import { cacheOwner, connectionKey } from './plans-schema';

/**
 * Reads of a person's own billing (ADR 0025). Migration 0110 added the person columns
 * (`payer_account_id` and friends) to the billing tables, but `schema.ts` does not declare them
 * (ADR 0025 section 13): Drizzle names every declared column in each insert and plain select, so
 * declaring them would break every agency billing read and write on a database before 0110, which
 * the release must tolerate. Person billing is therefore read here, by column name, only once
 * `personBillingPresent` says 0110 has run; before that, nobody has a paid traveller plan.
 */

/** Database handles and connections already seen with migration 0110 in place (only a yes is kept). */
const seen = new WeakMap<object, true>();
const seenConnections = new Set<string>();

/** Whether migration 0110 has run: the last column it adds exists. Never raises. */
export async function personBillingPresent(db: Db): Promise<boolean> {
  const owner = cacheOwner(db);
  if (seen.has(owner)) return true;
  const key = connectionKey(db);
  if (key !== null && seenConnections.has(key)) return true;
  const rows = await db
    .select({
      present: sql<boolean>`exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'payment_receipts' and column_name = 'payer_account_id') and to_regclass('person_receipt_counters') is not null`,
    })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) {
    seen.set(owner, true);
    if (key !== null) seenConnections.add(key);
  }
  return present;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CoveringPeriod {
  readonly planId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/**
 * The paid traveller plan covering `accountId` at `now`, if any: the person's current subscription
 * on a traveller plan, and a paid invoice of that subscription and plan, never refunded, whose
 * period holds `now` (start included, end excluded). A retired plan still covers a period already
 * paid for. Undefined before migration 0110, and for anything that is not an account id.
 */
export async function coveringPaidPeriod(
  db: Db,
  accountId: string,
  now: Date,
): Promise<CoveringPeriod | undefined> {
  if (!UUID.test(accountId) || !(await personBillingPresent(db))) return undefined;
  const refunded: SQL = invoiceHasRefundSql(sql`i.id`);
  const rows = await db.execute<{ plan_id: string; period_start: string; period_end: string }>(
    sql`select s.plan_id, i.period_start, i.period_end
      from subscriptions s
      join plans p on p.id = s.plan_id and p.audience = 'TRAVELLER'
      join invoices i on i.subscription_id = s.id and i.payer_account_id = s.payer_account_id
        and i.plan_id = s.plan_id and i.status = 'PAID'
        and i.period_start <= ${now.toISOString()}::timestamptz
        and i.period_end > ${now.toISOString()}::timestamptz
        and not ${refunded}
      where s.payer_account_id = ${accountId}::uuid and s.ended_at is null
      order by i.period_end desc
      limit 1`,
  );
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows;
  const row = (list ?? [])[0] as
    | { plan_id: string; period_start: string | Date; period_end: string | Date }
    | undefined;
  if (!row) return undefined;
  return {
    planId: row.plan_id,
    periodStart: new Date(row.period_start),
    periodEnd: new Date(row.period_end),
  };
}

/**
 * People on a paid traveller plan now: accounts with a current subscription of their own on a
 * traveller plan (ADR 0025). Zero before migration 0110. For the Plans page, which counts
 * everyone else as on Traveller Free.
 */
export async function peopleOnPaidTravellerPlans(db: Db): Promise<number> {
  if (!(await personBillingPresent(db))) return 0;
  const rows = await db.execute<{ n: number }>(
    sql`select count(distinct s.payer_account_id)::int as n
      from subscriptions s
      join plans p on p.id = s.plan_id and p.audience = 'TRAVELLER'
      where s.payer_account_id is not null and s.ended_at is null`,
  );
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows;
  const row = (list ?? [])[0] as { n: number | string } | undefined;
  return Number(row?.n ?? 0);
}
