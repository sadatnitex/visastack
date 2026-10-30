import { type SQL, sql } from 'drizzle-orm';
import { type Db, schema } from './db';

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

/** Handles already seen with migration 0107 complete. Only a "yes" is kept (see billing-history.ts). */
const seen = new WeakMap<object, true>();

/**
 * Whether migration 0107 has run to its end: the ledger's mode is filled in for every row and
 * required (its last column change), which also means every earlier statement ran. Never raises.
 */
export async function entitlementsSchemaPresent(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db
    .select({
      present: sql<boolean>`to_regclass('plan_prices') is not null and to_regclass('plan_entitlements') is not null and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'invoice_payments' and column_name = 'mode' and is_nullable = 'NO')`,
    })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) seen.set(db, true);
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
 * Every column of a ledger row. Before 0107 a row reads as LIVE: every row was counted as real
 * money then, which is what the accounting file did.
 */
export function ledgerColumns() {
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
    mode: addedColumn<PaymentMode>(p, 'mode', sql`'LIVE'`),
    createdAt: p.createdAt,
  };
}

/** One ledger row's mode expression (for a select that does not need the whole row). */
export function ledgerModeColumn(): SQL<PaymentMode> {
  return addedColumn<PaymentMode>(schema.invoicePayments, 'mode', sql`'LIVE'`);
}

/** One online payment's mode expression. */
export function attemptModeColumn(): SQL<PaymentMode> {
  return addedColumn<PaymentMode>(schema.paymentAttempts, 'mode', sql`'TEST'`);
}
