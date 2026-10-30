import { createHash } from 'node:crypto';
import { type SQL, sql } from 'drizzle-orm';
import { type Db, first, schema } from './db';

/**
 * Reading and writing plans, online payments and ledger rows so that the code works both before
 * and after migration 0107 (S29), following billing-history.ts (S17).
 *
 * 0107 adds `plans.audience`, `plans.bypass_limits`, `payment_attempts.mode` and
 * `invoice_payments.mode`, and the tables `plan_entitlements` and `plan_prices`. Drizzle names
 * every declared column in a plain select, a plain `returning()` and every insert, so before 0107
 * those would fail on the missing columns. The rules here:
 *
 * - Reads and `returning(...)` use the column lists below. Each new column is read through the
 *   row as JSON (`to_jsonb(row) ->> 'mode'`), which is empty before 0107, and an empty value reads
 *   as what the migration's backfill gives that row, so a page shows the same thing either side.
 * - Writes that set a new column, and every read of the new tables, happen only once
 *   `entitlementsSchemaPresent` says 0107 is in place. Before then a plan cannot be changed and an
 *   online payment cannot be started; a ledger row is written without its mode (the backfill
 *   fills it in).
 *
 * `plans-schema.test.ts` refuses a plain `.select()` or `.returning()` on these three tables
 * anywhere in this package, so a later change cannot bring the failure back.
 */

/** A payment made in the gateway's test mode (TEST) or with real money (LIVE). */
export type PaymentMode = (typeof schema.paymentMode.enumValues)[number];
export type PlanAudience = (typeof schema.planAudience.enumValues)[number];

/**
 * Database connections already seen with migration 0107 complete. Only a "yes" is kept (see
 * billing-history.ts). The key is the connection's query builder, which a connection shares with
 * every transaction opened on it (S29 round 3): so once a request has its answer, the ledger reads
 * and writes inside its transactions and row locks ask nothing more.
 */
const seen = new WeakMap<object, true>();

/**
 * Databases (by a hash of their connection string) already seen with migration 0107 complete,
 * for the whole process (S29 round 2): migrations are additive, so a "yes" stays true; a "no" is
 * never kept, because the migration may run at any moment. A handle whose connection string
 * cannot be read (an in-memory test database, a transaction) uses the per-connection record above.
 *
 * After any restore to a point before a migration, redeploy the app so running copies forget which
 * tables exist: a remembered "yes" would otherwise outlive the restore that took the tables away.
 */
const seenConnections = new Set<string>();

/**
 * What a handle's answer is kept against: the query builder a connection shares with every
 * transaction opened on it (and nested transactions), or the handle itself when it has none.
 */
function cacheOwner(db: Db): object {
  const dialect = (db as unknown as { dialect?: unknown }).dialect;
  return typeof dialect === 'object' && dialect !== null ? dialect : db;
}

/** A stable key for the database behind a handle, or null when it cannot be read. */
function connectionKey(db: Db): string | null {
  const client = (db as unknown as { $client?: unknown }).$client as
    | { options?: { connectionString?: unknown }; connectionString?: unknown }
    | undefined;
  const value = client?.options?.connectionString ?? client?.connectionString;
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Whether migration 0107 has run to its end: the ledger's mode is filled in for every row and
 * required (its last column change), which also means every earlier statement ran. Never raises.
 */
export async function entitlementsSchemaPresent(db: Db): Promise<boolean> {
  const owner = cacheOwner(db);
  if (seen.has(owner)) return true;
  const key = connectionKey(db);
  if (key !== null && seenConnections.has(key)) return true;
  const rows = await db
    .select({
      present: sql<boolean>`to_regclass('plan_prices') is not null and to_regclass('plan_entitlements') is not null and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'invoice_payments' and column_name = 'mode' and is_nullable = 'NO')`,
    })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) {
    seen.set(owner, true);
    if (key !== null) seenConnections.add(key);
  }
  return present;
}

/** A column added by 0107, read through the row so the query works before 0107 too. */
function addedColumn<T>(table: unknown, column: string, fallback: SQL): SQL<T> {
  return sql<T>`coalesce(to_jsonb(${table}) ->> ${column}, ${fallback})`;
}

/** Every column of a plan. Before 0107 the audience and the founding offer read as 0107 fills them. */
export function planColumns() {
  const p = schema.plans;
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    active: p.active,
    seatsAllowed: p.seatsAllowed,
    casesPerPeriodAllowed: p.casesPerPeriodAllowed,
    concurrentOpenCasesAllowed: p.concurrentOpenCasesAllowed,
    storageBytesAllowed: p.storageBytesAllowed,
    aiAllowanceUnitsAllowed: p.aiAllowanceUnitsAllowed,
    periodDays: p.periodDays,
    priceMinorUnits: p.priceMinorUnits,
    currency: p.currency,
    audience: addedColumn<PlanAudience>(
      p,
      'audience',
      sql`case when ${p.key} = 'traveller_free' then 'TRAVELLER' else 'AGENCY' end`,
    ),
    // The founding key and a zero price, exactly as the checks read it before S29.
    bypassLimits: sql<boolean>`coalesce((to_jsonb(${p}) ->> 'bypass_limits')::boolean, ${p.key} = 'agency_founding_access' and coalesce(${p.priceMinorUnits}, 0) = 0 and ${p.active})`,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Every column of an online payment. Before 0107 every one reads as TEST, as 0107 marks it. */
export function attemptColumns() {
  const a = schema.paymentAttempts;
  return {
    id: a.id,
    invoiceId: a.invoiceId,
    organizationId: a.organizationId,
    provider: a.provider,
    merchantTranId: a.merchantTranId,
    amountMinorUnits: a.amountMinorUnits,
    currency: a.currency,
    status: a.status,
    providerSessionKey: a.providerSessionKey,
    providerValId: a.providerValId,
    bankTranId: a.bankTranId,
    riskLevel: a.riskLevel,
    lastProviderStatus: a.lastProviderStatus,
    reasonCode: a.reasonCode,
    mode: addedColumn<PaymentMode>(a, 'mode', sql`'TEST'`),
    initiatedByAccountId: a.initiatedByAccountId,
    redirectedAt: a.redirectedAt,
    lastCheckedAt: a.lastCheckedAt,
    recordedAt: a.recordedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/**
 * A ledger row's mode, read the way it reads on this database (S29 round 2):
 * - after 0107, the stored mode;
 * - before it, exactly what 0107's backfill will write: an online payment or a credit takes its
 *   online payment's mode (TEST before 0107; LIVE when there is none), a refund takes its source's
 *   mode (the ledger row it gives back from, else its held payment, else LIVE), anything else is
 *   LIVE. Tables a database does not have yet (online payments before 0096, refunds before 0104)
 *   are left out of the expression; no row of that kind can exist then.
 */
export async function ledgerModeSql(db: Db): Promise<SQL<PaymentMode>> {
  const p = schema.invoicePayments;
  if (await entitlementsSchemaPresent(db)) return sql<PaymentMode>`${p.mode}::text`;
  const tables = first(
    await db
      .select({
        attempts: sql<boolean>`to_regclass('payment_attempts') is not null`,
        refunds: sql<boolean>`to_regclass('refund_requests') is not null`,
      })
      .from(sql`(select 1) as probe`),
  );
  const attemptMode = (alias: string, source: SQL | typeof p.sourceId) =>
    tables?.attempts === true
      ? sql`(select coalesce(to_jsonb(${sql.raw(alias)}) ->> 'mode', 'TEST') from payment_attempts ${sql.raw(alias)} where ${sql.raw(alias)}.id = ${source})`
      : sql`null`;
  const refundBranch =
    tables?.refunds === true
      ? sql`when ${p.kind} = 'REFUND' then (select coalesce(
            (select coalesce(to_jsonb(s0) ->> 'mode', case when s0.kind in ('ONLINE', 'CREDIT') then ${attemptMode('a2', sql`s0.source_id`)} end) from invoice_payments s0 where s0.id = r0.invoice_payment_id),
            ${attemptMode('a3', sql`r0.payment_attempt_id`)})
          from refund_requests r0 where r0.id = ${p.sourceId})`
      : sql``;
  return sql<PaymentMode>`coalesce(to_jsonb(${p}) ->> 'mode', case when ${p.kind} in ('ONLINE', 'CREDIT') then ${attemptMode('a1', p.sourceId)} ${refundBranch} end, 'LIVE')`;
}

/**
 * Every column of a ledger row, with its mode from `ledgerModeSql` (pass its result, so the read
 * gives the mode 0107 gives the row, before and after 0107).
 */
export function ledgerColumns(mode: SQL<PaymentMode>) {
  const p = schema.invoicePayments;
  return {
    id: p.id,
    seq: p.seq,
    invoiceId: p.invoiceId,
    amountMinorUnits: p.amountMinorUnits,
    currency: p.currency,
    kind: p.kind,
    sourceId: p.sourceId,
    provider: p.provider,
    providerTransactionId: p.providerTransactionId,
    reference: p.reference,
    collectedDate: p.collectedDate,
    recordedByAccountId: p.recordedByAccountId,
    mode,
    createdAt: p.createdAt,
  };
}

/** One online payment's mode expression. */
export function attemptModeColumn(): SQL<PaymentMode> {
  return addedColumn<PaymentMode>(schema.paymentAttempts, 'mode', sql`'TEST'`);
}

/**
 * The one TEST/LIVE rule at the gateway boundary (S29): a gateway only ever judges, refunds or
 * checks money taken in its own mode. Used by settlement, refund requests, refund retries, refund
 * checks and the refund panel. A port without a mode (not configured) serves nothing.
 */
export function gatewayServesMode(
  port: { readonly mode: PaymentMode | null },
  mode: PaymentMode,
): boolean {
  return port.mode !== null && port.mode === mode;
}
