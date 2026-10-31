import { sql } from 'drizzle-orm';
import type { SystemScope } from './access/principal';
import { invoiceHasRefundSql } from './billing-standing';
import type { Db } from './db';
import { serverErrorEvent } from './error-report';
import { formatObservabilityLine } from './observability-format';
import { RENEWAL_NOTICE_DAYS, processPersonRenewal } from './person-billing';
import { personBillingPresent } from './traveller-billing';
import { travellerPlansEnabled } from './traveller-plan';

/**
 * The person step of the daily billing run (ADR 0025 T4, D4): a person's paid plan is renewed by
 * paying a link, never charged by itself. This module finds who needs attention today; the work
 * for each person is `processPersonRenewal` (person-billing.ts), one transaction under that
 * person's locks:
 *
 * - Renewal: from 7 days before the last paid day, for a person who keeps renewing, on a plan
 *   still offered, while selling is switched on. Reminders at 7, 3 and 0 days, in the app and by
 *   email, while it is unpaid; none once they stop renewing.
 * - Lapse: 7 days after the last paid period ended with nothing paid since, the plan ends and they
 *   are told. Runs whether selling is on or off. Nothing is deleted.
 * - A renewal left open on a plan that is no longer theirs is cancelled.
 *
 * A failure for one person is counted, logged, rolled back and tried again on the next run.
 * Reruns create nothing new.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PersonRenewalSummary {
  readonly renewalInvoicesCreated: number;
  readonly remindersQueued: number;
  readonly lapsed: number;
  readonly failed: number;
}

export const NO_PERSON_RENEWALS: PersonRenewalSummary = {
  renewalInvoicesCreated: 0,
  remindersQueued: 0,
  lapsed: 0,
  failed: 0,
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * The people with work today, the soonest end first: a current paid traveller plan whose last
 * paid, unrefunded period ends within the notice window (or has ended), and anyone with an open
 * renewal on a plan that is no longer theirs. One more than `limit`, so a run that cannot finish
 * says so.
 */
async function peopleDue(db: Db, now: Date, limit: number): Promise<string[]> {
  // A day more than the notice, so the calendar-day count in Bangladesh is decided per person.
  const horizon = new Date(now.getTime() + (RENEWAL_NOTICE_DAYS + 1) * DAY_MS).toISOString();
  const refunded = invoiceHasRefundSql(sql`i.id`);
  const result = await db.execute(sql`
    select payer from (
      select s.payer_account_id as payer, max(i.period_end) as due
      from subscriptions s
      join plans p on p.id = s.plan_id and p.audience = 'TRAVELLER'
      join invoices i on i.subscription_id = s.id and i.payer_account_id = s.payer_account_id
        and i.status = 'PAID' and not ${refunded}
      where s.payer_account_id is not null and s.ended_at is null
      group by s.payer_account_id
      having max(i.period_end) <= ${horizon}::timestamptz
      union all
      select i.payer_account_id as payer, min(i.period_start) as due
      from invoices i
      join subscriptions s on s.id = i.subscription_id and s.ended_at is not null
      where i.payer_account_id is not null and i.status = 'OPEN'
      group by i.payer_account_id
    ) due
    group by payer
    order by min(due), payer
    limit ${limit + 1}`);
  return rowsOf<{ payer: string }>(result).map((row) => row.payer);
}

function logFailure(error: unknown, step: string): void {
  console.error(
    formatObservabilityLine(serverErrorEvent('billingCycle', error, { step: `person ${step}` })),
  );
}

/**
 * The person step of the daily billing run. Before migrations 0110 and 0111 there is nothing to
 * do. `deadline` says when no more work may start (the run's budget for this step).
 */
export async function runPersonRenewals(
  db: Db,
  scope: SystemScope<'process-billing-cycle'>,
  options: {
    readonly now: Date;
    readonly limit: number;
    /** True once no more work may start (the run's budget for this step). */
    readonly deadline: () => boolean;
  },
): Promise<PersonRenewalSummary> {
  if (scope.job !== 'process-billing-cycle') throw new Error('wrong job scope');
  let people: string[];
  try {
    if (!(await personBillingPresent(db))) return NO_PERSON_RENEWALS;
    people = await peopleDue(db, options.now, options.limit);
  } catch (error) {
    // The agency steps have already run; this step tries again tomorrow.
    logFailure(error, 'listing');
    return { ...NO_PERSON_RENEWALS, failed: 1 };
  }
  const selling = travellerPlansEnabled();
  let renewalInvoicesCreated = 0;
  let remindersQueued = 0;
  let lapsed = 0;
  let failed = 0;
  for (const accountId of people) {
    if (options.deadline()) break;
    try {
      const done = await processPersonRenewal(db, scope, {
        accountId,
        now: options.now,
        selling,
      });
      if (done.created) renewalInvoicesCreated++;
      if (done.reminded) remindersQueued++;
      if (done.lapsed) lapsed++;
    } catch (error) {
      failed++;
      logFailure(error, 'renewal');
    }
  }
  return { renewalInvoicesCreated, remindersQueued, lapsed, failed };
}
