import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { reconcileRestoredBranch } from './backup-reconciliation';
import type { Db } from './db';
import { AGENCY_FOUNDING_PLAN_KEY } from './founding-access';
import {
  createOrganization,
  reviewOrganization,
  terminateOrganization,
  withdrawOrganizationApplication,
} from './organizations';
import { executeScheduledDowngrade } from './plans';

/**
 * Owner decision "Founding A" (1 Nov 2026): when an agency withdraws its application or is
 * terminated, its plan ends as the agency closes, so it can never renew (closing already ends every
 * access, and Founding Access is free, so no paid period is left). Nothing is refunded
 * automatically, a waiting downgrade can never put a plan back, and an agency with no plan closes
 * as before.
 */

let db: Db;
let owner: string;
let reviewer: string;

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  owner = await account('owner-founding-a@agency.example.com');
  reviewer = await account('reviewer-founding-a@platform.example.com');
}, 60_000);

async function newAgency(): Promise<string> {
  const made = await createOrganization(db, { actorAccountId: owner, name: 'Founding A Visas' });
  if (!isOk(made)) throw new Error('organization');
  return made.value.id;
}

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function reject(organizationId: string) {
  return reviewOrganization(db, {
    reviewerAccountId: reviewer,
    organizationId,
    decision: 'REJECTED',
    stepUpSatisfied: true,
  });
}

/**
 * A restored branch holding this agency as it was at the restore point: its owner, the agency
 * waiting for review, its plan and the plan's current subscription.
 */
async function restoredBranchOf(organizationId: string): Promise<Db> {
  const restored = await freshDb();
  for (const row of await db.select().from(schema.accounts)) {
    await restored.insert(schema.accounts).values(row).onConflictDoNothing();
  }
  for (const row of await db.select().from(schema.plans)) {
    await restored.insert(schema.plans).values(row).onConflictDoNothing();
  }
  for (const row of await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))) {
    await restored.insert(schema.organizations).values(row);
  }
  for (const row of await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.organizationId, organizationId))) {
    await restored.insert(schema.subscriptions).values(row);
  }
  return restored;
}

async function activate(organizationId: string): Promise<void> {
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

interface PlanRow {
  readonly id: string;
  readonly ended_at: Date | string | null;
  readonly plan_key: string;
}

async function plansOf(organizationId: string): Promise<PlanRow[]> {
  const result = await db.execute(sql`
    select s.id, s.ended_at, p.key as plan_key
    from subscriptions s join plans p on p.id = s.plan_id
    where s.organization_id = ${organizationId}::uuid
    order by s.created_at`);
  return (result as unknown as { rows: PlanRow[] }).rows;
}

async function auditsOf(eventType: string) {
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, eventType));
}

/**
 * A downgrade still waiting for this agency, to a second agency plan, with its notice to the
 * owner still queued. `due` puts its date in the past, ready for the daily run.
 */
async function waitingDowngrade(organizationId: string, due = false): Promise<string> {
  const [founding] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.key, AGENCY_FOUNDING_PLAN_KEY));
  const [smaller] = await db
    .insert(schema.plans)
    .values({ key: 'agency_smaller_founding_a', name: 'Smaller', audience: 'AGENCY' })
    .returning({ id: schema.plans.id });
  if (!founding || !smaller) throw new Error('plans');
  const [row] = await db
    .insert(schema.scheduledDowngrades)
    .values({
      organizationId,
      fromPlanId: founding.id,
      toPlanId: smaller.id,
      requestedAt: new Date(Date.now() - 2 * 86_400_000),
      effectiveAt: new Date(Date.now() + (due ? -1 : 7) * 86_400_000),
      requestedByAccountId: reviewer,
      reason: 'test',
    })
    .returning({ id: schema.scheduledDowngrades.id });
  if (!row) throw new Error('downgrade');
  await db.insert(schema.notifications).values({
    eventType: 'DOWNGRADE_SCHEDULED',
    channel: 'IN_APP',
    idempotencyKey: `downgrade-notice-${row.id}`,
    recipientAccountId: owner,
    organizationId,
    resourceId: row.id,
    payload: {},
  });
  return row.id;
}

async function noticeStatus(downgradeId: string): Promise<string | undefined> {
  const [notice] = await db
    .select({ status: schema.notifications.status })
    .from(schema.notifications)
    .where(eq(schema.notifications.resourceId, downgradeId));
  return notice?.status;
}

async function billingCounts(): Promise<Record<string, number>> {
  const result = await db.execute(sql`
    select (select count(*) from invoices)::int as invoices,
      (select count(*) from invoice_payments)::int as payments,
      (select count(*) from refund_requests)::int as refunds`);
  return (result as unknown as { rows: Record<string, number>[] }).rows[0] ?? {};
}

describe('a closing agency keeps no plan (owner decision Founding A)', () => {
  it('withdrawing the application stops renewing and ends Founding Access, refunds nothing and cancels a waiting downgrade', async () => {
    const organizationId = await newAgency();
    const [before] = await plansOf(organizationId);
    expect(before).toMatchObject({ plan_key: AGENCY_FOUNDING_PLAN_KEY, ended_at: null });
    const downgradeId = await waitingDowngrade(organizationId);
    const money = await billingCounts();

    const withdrawn = await withdrawOrganizationApplication(db, {
      actorAccountId: owner,
      organizationId,
    });
    expect(isOk(withdrawn) && withdrawn.value.status).toBe('CLOSED');

    const after = await plansOf(organizationId);
    expect(after).toHaveLength(1);
    // Ended, so it can never renew: agency invoicing reads only current subscriptions.
    expect(after[0]?.ended_at).not.toBeNull();
    const [downgrade] = await db
      .select()
      .from(schema.scheduledDowngrades)
      .where(eq(schema.scheduledDowngrades.id, downgradeId));
    expect(downgrade).toMatchObject({
      status: 'CANCELLED',
      cancelledByAccountId: owner,
      cancelledReason: 'the agency withdrew its application',
    });
    // Its notice still waiting to go out is withdrawn with it.
    expect(await noticeStatus(downgradeId)).toBe('CANCELLED');
    // Nothing else in billing moves: no invoice, payment or refund is made.
    expect(await billingCounts()).toEqual(money);

    const [ended] = await auditsOf('SUBSCRIPTION_ENDED');
    expect(ended).toMatchObject({
      actorAccountId: owner,
      resourceType: 'subscription',
      resourceId: before?.id,
      reason: 'application_withdrawn',
      metadata: { organizationId, renewalStopped: true, refunded: false, downgradeCancelled: true },
    });
    const [closing] = await auditsOf('ORGANIZATION_APPLICATION_WITHDRAWN');
    expect(closing?.metadata).toMatchObject({ subscriptionEnded: true });
  });

  it('terminating an agency stops renewing and ends its plan, refunding nothing', async () => {
    const organizationId = await newAgency();
    await activate(organizationId);
    const [before] = await plansOf(organizationId);
    const money = await billingCounts();

    const terminated = await terminateOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId,
      stepUpSatisfied: true,
    });
    expect(isOk(terminated) && terminated.value.status).toBe('CLOSED');

    const [after] = await plansOf(organizationId);
    expect(after?.ended_at).not.toBeNull();
    expect(await billingCounts()).toEqual(money);
    const [ended] = await auditsOf('SUBSCRIPTION_ENDED');
    expect(ended).toMatchObject({
      actorAccountId: reviewer,
      resourceId: before?.id,
      reason: 'organization_terminated',
      metadata: {
        organizationId,
        renewalStopped: true,
        refunded: false,
        downgradeCancelled: false,
      },
    });
    const [closing] = await auditsOf('ORGANIZATION_TERMINATED');
    expect(closing?.metadata).toMatchObject({ previousStatus: 'ACTIVE', subscriptionEnded: true });
  });

  it('rejecting an application ends its plan the same way, refunding nothing; approving leaves it', async () => {
    const organizationId = await newAgency();
    const [before] = await plansOf(organizationId);
    const downgradeId = await waitingDowngrade(organizationId);
    const money = await billingCounts();

    const rejected = await reject(organizationId);
    expect(isOk(rejected) && rejected.value.status).toBe('REJECTED');

    const [after] = await plansOf(organizationId);
    expect(after?.ended_at).not.toBeNull();
    const [downgrade] = await db
      .select()
      .from(schema.scheduledDowngrades)
      .where(eq(schema.scheduledDowngrades.id, downgradeId));
    expect(downgrade).toMatchObject({
      status: 'CANCELLED',
      cancelledByAccountId: reviewer,
      cancelledReason: 'the application was rejected',
    });
    expect(await noticeStatus(downgradeId)).toBe('CANCELLED');
    expect(await billingCounts()).toEqual(money);
    const [ended] = await auditsOf('SUBSCRIPTION_ENDED');
    expect(ended).toMatchObject({
      actorAccountId: reviewer,
      resourceId: before?.id,
      reason: 'application_rejected',
      metadata: { organizationId, renewalStopped: true, refunded: false, downgradeCancelled: true },
    });
    const [review] = await auditsOf('ORGANIZATION_REVIEWED');
    expect(review?.metadata).toEqual({ decision: 'REJECTED', subscriptionEnded: true });

    // An approval keeps the plan, and records the review exactly as before.
    const approvedAgency = await newAgency();
    await activate(approvedAgency);
    const [kept] = await plansOf(approvedAgency);
    expect(kept?.ended_at).toBeNull();
    const reviews = await auditsOf('ORGANIZATION_REVIEWED');
    expect(reviews.find((r) => r.resourceId === approvedAgency)?.metadata).toEqual({
      decision: 'ACTIVE',
    });
  });

  it('a restore never brings back an ended plan or a rejected application to waiting', async () => {
    const organizationId = await newAgency();
    const restored = await restoredBranchOf(organizationId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const restorePoint = new Date();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(isOk(await reject(organizationId))).toBe(true);
    const [subscription] = await plansOf(organizationId);

    const report = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(report.errors).toEqual([]);
    expect(report.counts.subscriptionsEnded).toBe(1);
    expect(report.counts.organizationsForced).toBe(1);
    const [org] = await restored
      .select({ status: schema.organizations.status })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    expect(org?.status).toBe('REJECTED');
    const [restoredPlan] = await restored
      .select({ endedAt: schema.subscriptions.endedAt })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subscription?.id ?? ''));
    expect(restoredPlan?.endedAt).not.toBeNull();
    const attributed = await restored
      .select({ eventType: schema.auditEvents.eventType })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.reason, 'backup_resurrection_reconciliation'));
    expect(attributed.map((a) => a.eventType).sort()).toEqual([
      'RECONCILIATION_ORGANIZATION_REVIEWED',
      'RECONCILIATION_SUBSCRIPTION_ENDED',
    ]);

    // A second run changes nothing.
    const again = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(again.counts.subscriptionsEnded).toBe(0);
    expect(again.counts.organizationsForced).toBe(0);
  });

  it("a restore never replays an approval: it is the platform's to make again", async () => {
    const organizationId = await newAgency();
    const restored = await restoredBranchOf(organizationId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const restorePoint = new Date();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await activate(organizationId);
    const report = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(report.counts.organizationsForced).toBe(0);
    expect(report.counts.subscriptionsEnded).toBe(0);
    const [org] = await restored
      .select({ status: schema.organizations.status })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    expect(org?.status).toBe('PENDING_VERIFICATION');
  });

  it('closes an agency that has no plan exactly as before, with nothing to end', async () => {
    const withdrawing = await newAgency();
    const terminating = await newAgency();
    await activate(terminating);
    await db.execute(sql`update subscriptions set ended_at = now()
      where organization_id in (${withdrawing}::uuid, ${terminating}::uuid)`);

    const withdrawn = await withdrawOrganizationApplication(db, {
      actorAccountId: owner,
      organizationId: withdrawing,
    });
    expect(isOk(withdrawn) && withdrawn.value.status).toBe('CLOSED');
    const terminated = await terminateOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: terminating,
      stepUpSatisfied: true,
    });
    expect(isOk(terminated) && terminated.value.status).toBe('CLOSED');

    expect(await auditsOf('SUBSCRIPTION_ENDED')).toHaveLength(0);
    const [withdrawAudit] = await auditsOf('ORGANIZATION_APPLICATION_WITHDRAWN');
    expect(withdrawAudit?.metadata).toMatchObject({ subscriptionEnded: false });
    const [terminateAudit] = await auditsOf('ORGANIZATION_TERMINATED');
    expect(terminateAudit?.metadata).toMatchObject({ subscriptionEnded: false });
  });

  it('the daily downgrade run never puts a plan back on a closed agency (for example after a restore)', async () => {
    const organizationId = await newAgency();
    await activate(organizationId);
    const downgradeId = await waitingDowngrade(organizationId, true);
    // A restore can bring back a closed agency's plan and its waiting downgrade.
    await db.execute(
      sql`update organizations set status = 'CLOSED' where id = ${organizationId}::uuid`,
    );
    const run = await executeScheduledDowngrade(db, { downgradeId });
    expect(isOk(run)).toBe(false);
    const plans = await plansOf(organizationId);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.plan_key).toBe(AGENCY_FOUNDING_PLAN_KEY);
    const [downgrade] = await db
      .select({ status: schema.scheduledDowngrades.status })
      .from(schema.scheduledDowngrades)
      .where(eq(schema.scheduledDowngrades.id, downgradeId));
    expect(downgrade?.status).toBe('PENDING');
    // A rejected agency is refused the same way.
    await db.execute(
      sql`update organizations set status = 'REJECTED' where id = ${organizationId}::uuid`,
    );
    expect(isOk(await executeScheduledDowngrade(db, { downgradeId }))).toBe(false);
    // The same downgrade on an agency still open is applied as before.
    await db.execute(
      sql`update organizations set status = 'ACTIVE' where id = ${organizationId}::uuid`,
    );
    expect(isOk(await executeScheduledDowngrade(db, { downgradeId }))).toBe(true);
  });

  it('a refused withdrawal or termination leaves the plan as it was', async () => {
    const organizationId = await newAgency();
    const stranger = await account('stranger-founding-a@example.com');
    const refused = await withdrawOrganizationApplication(db, {
      actorAccountId: stranger,
      organizationId,
    });
    expect(isOk(refused)).toBe(false);
    const noStepUp = await terminateOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId,
      stepUpSatisfied: false,
    });
    expect(isOk(noStepUp)).toBe(false);
    const [plan] = await plansOf(organizationId);
    expect(plan).toMatchObject({ ended_at: null });
    const current = await db
      .select({ id: schema.subscriptions.id })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.organizationId, organizationId),
          sql`${schema.subscriptions.endedAt} is null`,
        ),
      );
    expect(current).toHaveLength(1);
  });
});
