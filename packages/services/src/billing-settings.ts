import { type Result, err, ok } from '@visastack/core';
import { eq, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * The platform's billing rules (S17, ADR 0020 Phase 2, owner gate O13): one row, changed only by
 * the platform owner after a fresh sign-in check.
 *
 * - `dueDays`: an invoice the daily billing run makes is due this many days after its period
 *   starts.
 * - Automatic Grace and Suspended: off until the owner switches it on. When on, an agency whose
 *   invoice is still unpaid `graceAfterDays` after its due date moves to Grace, and
 *   `suspendAfterDays` after its due date to Suspended (both counted from the due date, Suspended
 *   later than Grace). Paying in full ends a Grace or Suspended status that VisaStack set; a
 *   status a person set is never changed automatically.
 * - `invoicingStartsAt`: set when migration 0103 runs. The daily run never bills a period that
 *   started before it, so recurring invoices start from that day and never bill the past.
 *
 * Before migration 0103 the table does not exist: reading returns the standard rules marked not
 * available (the daily run then does nothing) and saving is refused as not ready yet.
 */

export const BILLING_DUE_DAYS_DEFAULT = 7;
export const BILLING_DUE_DAYS_MIN = 1;
export const BILLING_DUE_DAYS_MAX = 60;
export const BILLING_POLICY_DAYS_MAX = 365;

/** The refusal for a save before migration 0103 has run. */
export const BILLING_SETTINGS_UNAVAILABLE = 'billing rules are not available yet';

export interface BillingSettings {
  /** False before migration 0103: the values are the standard ones and nothing is billed. */
  readonly available: boolean;
  readonly dueDays: number;
  readonly overdueHandlingEnabled: boolean;
  readonly graceAfterDays: number | null;
  readonly suspendAfterDays: number | null;
  /** Null before migration 0103. */
  readonly invoicingStartsAt: Date | null;
  readonly updatedByAccountId: string | null;
  readonly updatedAt: Date | null;
}

const STANDARD: BillingSettings = {
  available: false,
  dueDays: BILLING_DUE_DAYS_DEFAULT,
  overdueHandlingEnabled: false,
  graceAfterDays: null,
  suspendAfterDays: null,
  invoicingStartsAt: null,
  updatedByAccountId: null,
  updatedAt: null,
};

/** Whether migration 0103 has created the billing rules table. Never raises. */
export async function billingSettingsPresent(db: Db): Promise<boolean> {
  const rows = await db
    .select({ present: sql<boolean>`to_regclass('billing_settings') is not null` })
    .from(sql`(select 1) as probe`);
  return rows[0]?.present === true;
}

/**
 * The current billing rules, or the standard ones marked not available before migration 0103.
 * For the daily run and this module; staff screens use `getBillingSettings`.
 */
export async function readBillingSettings(db: Db): Promise<BillingSettings> {
  if (!(await billingSettingsPresent(db))) return STANDARD;
  const row = first(
    await db
      .select()
      .from(schema.billingSettings)
      .where(eq(schema.billingSettings.id, true))
      .limit(1),
  );
  // The migration writes the one row. Without it nobody knows when invoicing may start, so
  // nothing is billed.
  if (!row) return STANDARD;
  return {
    available: true,
    dueDays: row.dueDays,
    overdueHandlingEnabled: row.overdueHandlingEnabled,
    graceAfterDays: row.graceAfterDays,
    suspendAfterDays: row.suspendAfterDays,
    invoicingStartsAt: row.invoicingStartsAt,
    updatedByAccountId: row.updatedByAccountId,
    updatedAt: row.updatedAt,
  };
}

/** The billing rules, for the platform owner's Billing Rules page (a read: no fresh sign-in check). */
export async function getBillingSettings(
  db: Db,
  staff: StaffScope<'BILLING_SETTINGS_MANAGE'>,
): Promise<Result<BillingSettings, ServiceError>> {
  const denied = staffScopeProblem(staff, 'BILLING_SETTINGS_MANAGE');
  if (denied) return err(denied);
  return ok(await readBillingSettings(db));
}

export interface BillingRulesInput {
  readonly dueDays: number;
  readonly overdueHandlingEnabled: boolean;
  /** Both day counts together or neither. Required when automatic handling is on. */
  readonly graceAfterDays: number | null;
  readonly suspendAfterDays: number | null;
}

function wholeIn(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** The first problem with a set of rules, in plain words, or null when they are valid. */
export function billingRulesProblem(input: BillingRulesInput): string | null {
  if (!wholeIn(input.dueDays, BILLING_DUE_DAYS_MIN, BILLING_DUE_DAYS_MAX)) {
    return `Payment due after must be a whole number of days from ${BILLING_DUE_DAYS_MIN} to ${BILLING_DUE_DAYS_MAX}.`;
  }
  const grace = input.graceAfterDays;
  const suspend = input.suspendAfterDays;
  if ((grace === null) !== (suspend === null)) {
    return 'Enter both day counts, or leave both empty.';
  }
  if (input.overdueHandlingEnabled && (grace === null || suspend === null)) {
    return 'Enter both day counts before turning automatic Grace and Suspended on.';
  }
  if (grace !== null && suspend !== null) {
    // Overdue starts the Bangladesh day after the due day, so 1 is the earliest Grace can begin.
    if (!wholeIn(grace, 1, BILLING_POLICY_DAYS_MAX - 1)) {
      return `Grace must start a whole number of days from 1 to ${BILLING_POLICY_DAYS_MAX - 1} after the due date (1 means the day after the due date).`;
    }
    if (!wholeIn(suspend, 2, BILLING_POLICY_DAYS_MAX)) {
      return `Suspended must start a whole number of days from 2 to ${BILLING_POLICY_DAYS_MAX} after the due date.`;
    }
    if (suspend <= grace) return 'Suspended must start later than Grace.';
  }
  return null;
}

export interface UpdateBillingSettingsInput extends BillingRulesInput {
  readonly stepUpSatisfied: boolean;
}

export interface BillingSettingsChange {
  readonly settings: BillingSettings;
  /** False when the saved rules were already these. */
  readonly changed: boolean;
}

/**
 * Saves the billing rules. Platform owner only (`BILLING_SETTINGS_MANAGE` is held by no other
 * role), with a fresh sign-in check, refused before migration 0103. Every change is audited with
 * the rules before and after.
 */
export async function updateBillingSettings(
  db: Db,
  staff: StaffScope<'BILLING_SETTINGS_MANAGE'>,
  input: UpdateBillingSettingsInput,
): Promise<Result<BillingSettingsChange, ServiceError>> {
  const denied = staffScopeProblem(staff, 'BILLING_SETTINGS_MANAGE');
  if (denied) return err(denied);
  const problem = billingRulesProblem(input);
  if (problem) return err(serviceError('invalid', problem));
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'changing billing rules requires reauthentication'),
    );
  }
  if (!(await billingSettingsPresent(db))) {
    return err(serviceError('invalid', BILLING_SETTINGS_UNAVAILABLE));
  }
  return db.transaction(async (tx) => {
    const before = first(
      await tx
        .select()
        .from(schema.billingSettings)
        .where(eq(schema.billingSettings.id, true))
        .limit(1)
        .for('update'),
    );
    if (!before) return err(serviceError('invalid', BILLING_SETTINGS_UNAVAILABLE));
    const unchanged =
      before.dueDays === input.dueDays &&
      before.overdueHandlingEnabled === input.overdueHandlingEnabled &&
      before.graceAfterDays === input.graceAfterDays &&
      before.suspendAfterDays === input.suspendAfterDays;
    if (unchanged) return ok({ settings: await readBillingSettings(tx), changed: false });
    const updated = required(
      first(
        await tx
          .update(schema.billingSettings)
          .set({
            dueDays: input.dueDays,
            overdueHandlingEnabled: input.overdueHandlingEnabled,
            graceAfterDays: input.graceAfterDays,
            suspendAfterDays: input.suspendAfterDays,
            updatedByAccountId: staff.accountId,
            updatedAt: new Date(),
          })
          .where(eq(schema.billingSettings.id, true))
          .returning(),
      ),
      'billing settings',
    );
    const rules = (row: typeof before) => ({
      dueDays: row.dueDays,
      overdueHandlingEnabled: row.overdueHandlingEnabled,
      graceAfterDays: row.graceAfterDays,
      suspendAfterDays: row.suspendAfterDays,
    });
    await appendAuditEvent(tx, {
      eventType: 'BILLING_SETTINGS_UPDATED',
      actorAccountId: staff.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'billing_settings',
      resourceId: 'platform',
      metadata: { before: rules(before), after: rules(updated) },
    });
    return ok({ settings: await readBillingSettings(tx), changed: true });
  });
}
