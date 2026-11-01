import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { appendAuditEvent } from './audit';
import { reconcileRestoredBranch } from './backup-reconciliation';
import type { Db } from './db';
import { AGENCY_FOUNDING_PLAN_KEY } from './founding-access';
import { createOrganization, reviewOrganization } from './organizations';
import { activateSubscription, executeScheduledDowngrade } from './plans';
import { grantPlatformRole } from './platform-roles';

/**
 * Owner decision (1 Nov 2026): a restore from backup never brings back an ended plan, whatever
 * ended it (a plan change, an executed downgrade, a traveller's lapse, refund or plan switch). The
 * restored branch is compared with the pre-incident branch, and every plan the restore ends is
 * listed for the owner with whether that agency or traveller still has a current plan.
 */

const OWNER_EMAIL = 'platform-owner-restore@platform.example.com';
let db: Db;
let platformOwner: string;
let agencyOwner: string;

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

beforeEach(async () => {
  db = await freshDb();
  platformOwner = await account(OWNER_EMAIL);
  const granted = await grantPlatformRole(db, {
    actor: { accountId: platformOwner, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
    targetAccountId: platformOwner,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  agencyOwner = await account('agency-owner-restore@agency.example.com');
}, 60_000);

async function activeAgency(): Promise<string> {
  const made = await createOrganization(db, { actorAccountId: agencyOwner, name: 'Restore Visas' });
  if (!isOk(made)) throw new Error('organization');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: platformOwner,
    organizationId: made.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  return made.value.id;
}

async function agencyPlan(key: string): Promise<string> {
  await db
    .insert(schema.plans)
    .values({ key, name: key, audience: 'AGENCY' })
    .onConflictDoNothing({ target: schema.plans.key });
  const [plan] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.key, key));
  if (!plan) throw new Error('plan');
  return plan.id;
}

/** The restored branch: every row of these tables as they are now (the restore point). */
async function restoredBranch(): Promise<Db> {
  const restored = await freshDb();
  for (const row of await db.select().from(schema.accounts)) {
    await restored.insert(schema.accounts).values(row).onConflictDoNothing();
  }
  for (const row of await db.select().from(schema.plans)) {
    await restored.insert(schema.plans).values(row).onConflictDoNothing();
  }
  for (const row of await db.select().from(schema.organizations)) {
    await restored.insert(schema.organizations).values(row);
  }
  await restored.execute(sql`alter table subscriptions disable trigger user`);
  const subscriptions = (
    (await db.execute(sql`select * from subscriptions`)) as unknown as {
      rows: {
        id: string;
        organization_id: string | null;
        payer_account_id: string | null;
        plan_id: string;
        started_at: string;
        ended_at: string | null;
        assigned_by_account_id: string | null;
        reason: string;
        renews: boolean;
        created_at: string;
      }[];
    }
  ).rows;
  for (const row of subscriptions) {
    await restored.execute(sql`insert into subscriptions
      (id, organization_id, payer_account_id, plan_id, started_at, ended_at, assigned_by_account_id, reason, renews, created_at)
      values (${row.id}, ${row.organization_id}, ${row.payer_account_id}, ${row.plan_id},
        ${row.started_at}, ${row.ended_at}, ${row.assigned_by_account_id}, ${row.reason},
        ${row.renews}, ${row.created_at})`);
  }
  await restored.execute(sql`alter table subscriptions enable trigger user`);
  for (const row of await db.select().from(schema.scheduledDowngrades)) {
    await restored.insert(schema.scheduledDowngrades).values(row);
  }
  return restored;
}

/** A pause, so the restore point falls strictly between what came before and after it. */
async function restorePointNow(): Promise<Date> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  const point = new Date();
  await new Promise((resolve) => setTimeout(resolve, 5));
  return point;
}

async function currentPlans(branch: Db, organizationId: string) {
  return branch
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.organizationId, organizationId),
        isNull(schema.subscriptions.endedAt),
      ),
    );
}

describe('a restore never brings back an ended plan, whatever ended it', () => {
  it('a plan change after the restore point: the old plan ends there too, and the owner is told which plan to give back', async () => {
    const organizationId = await activeAgency();
    const [founding] = await currentPlans(db, organizationId);
    const restored = await restoredBranch();
    const restorePoint = await restorePointNow();
    const changed = await activateSubscription(db, {
      actor: { accountId: platformOwner, email: OWNER_EMAIL, bootstrapEmails: [] },
      stepUpSatisfied: true,
      organizationId,
      planId: await agencyPlan('agency_pro_restore'),
      reason: 'moved to Pro',
    });
    expect(isOk(changed)).toBe(true);

    const report = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(report.errors).toEqual([]);
    expect(await currentPlans(restored, organizationId)).toEqual([]);
    expect(report.counts.subscriptionsEnded).toBe(1);
    // The new plan cannot come back with a restore: the list says which one to give back.
    expect(report.plansToCheck).toEqual([
      expect.objectContaining({
        subscriptionId: founding?.id,
        organizationId,
        payerAccountId: null,
        endedPlanKey: AGENCY_FOUNDING_PLAN_KEY,
        reason: 'plan_changed',
        planNow: null,
        planOnPreIncidentBranch: 'agency_pro_restore',
        needsAction: true,
      }),
    ]);

    // A second run changes nothing; the list still names who needs their plan back.
    const again = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(again.counts.subscriptionsEnded).toBe(0);
    expect(again.plansToCheck.map((plan) => plan.needsAction)).toEqual([true]);
  });

  it('an executed downgrade after the restore point: the old plan ends there and its downgrade is cancelled', async () => {
    const organizationId = await activeAgency();
    const [{ id: fromPlanId } = { id: '' }] = await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.key, AGENCY_FOUNDING_PLAN_KEY));
    const [downgrade] = await db
      .insert(schema.scheduledDowngrades)
      .values({
        organizationId,
        fromPlanId,
        toPlanId: await agencyPlan('agency_small_restore'),
        requestedAt: new Date(Date.now() - 2 * 86_400_000),
        effectiveAt: new Date(Date.now() - 86_400_000),
        requestedByAccountId: platformOwner,
        reason: 'smaller',
      })
      .returning({ id: schema.scheduledDowngrades.id });
    const restored = await restoredBranch();
    const restorePoint = await restorePointNow();
    expect(isOk(await executeScheduledDowngrade(db, { downgradeId: downgrade?.id ?? '' }))).toBe(
      true,
    );

    const report = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(report.errors).toEqual([]);
    expect(await currentPlans(restored, organizationId)).toEqual([]);
    expect(report.plansToCheck).toEqual([
      expect.objectContaining({
        reason: 'downgrade_executed',
        planNow: null,
        planOnPreIncidentBranch: 'agency_small_restore',
        needsAction: true,
      }),
    ]);
    // Nothing is left to change from, so the waiting downgrade is not tried every day.
    const [left] = await restored
      .select({ status: schema.scheduledDowngrades.status })
      .from(schema.scheduledDowngrades)
      .where(eq(schema.scheduledDowngrades.id, downgrade?.id ?? ''));
    expect(left?.status).toBe('CANCELLED');
  });

  it("a traveller's plan ended after the restore point (refunded): it ends there, nothing to give back, and its renewal reminder stops", async () => {
    const traveller = await account('traveller-restore@example.com');
    const [plan] = await db
      .insert(schema.plans)
      .values({ key: 'traveller_plus_restore', name: 'Traveller Plus', audience: 'TRAVELLER' })
      .returning({ id: schema.plans.id });
    const subscriptionId = (
      (await db.execute(sql`insert into subscriptions (payer_account_id, plan_id, reason)
        values (${traveller}::uuid, ${plan?.id}::uuid, 'Traveller Plus') returning id`)) as unknown as {
        rows: { id: string }[];
      }
    ).rows[0]?.id;
    const restored = await restoredBranch();
    // The plan's renewal, still open, with its reminder waiting to go out on the restored branch.
    const renewalId = (
      (await restored.execute(sql`insert into invoices (payer_account_id, plan_id, subscription_id,
          period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
        values (${traveller}::uuid, ${plan?.id}::uuid, ${subscriptionId}::uuid, now() + interval '1 day',
          now() + interval '31 days', 'VS-RESTORE-RENEWAL', 49900, 'BDT', now() + interval '1 day')
        returning id`)) as unknown as { rows: { id: string }[] }
    ).rows[0]?.id;
    await restored.insert(schema.notifications).values({
      eventType: 'PERSON_PLAN_RENEWAL_DUE',
      channel: 'IN_APP',
      idempotencyKey: `renewal-${renewalId}`,
      recipientAccountId: traveller,
      resourceId: renewalId ?? '',
      payload: {},
    });
    const restorePoint = await restorePointNow();
    // The refund ends the plan and records the ending, as settlePlanAfterRefund does.
    await db.execute(
      sql`update subscriptions set ended_at = now() where id = ${subscriptionId}::uuid`,
    );
    await appendAuditEvent(db, {
      eventType: 'SUBSCRIPTION_ENDED',
      actorAccountId: platformOwner,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'subscription',
      resourceId: subscriptionId ?? '',
      reason: 'refunded',
      metadata: { personPlan: true },
    });

    const report = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(report.errors).toEqual([]);
    const [restoredRow] = await restored
      .select({ endedAt: schema.subscriptions.endedAt })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subscriptionId ?? ''));
    expect(restoredRow?.endedAt).not.toBeNull();
    const [reminder] = await restored
      .select({ status: schema.notifications.status })
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, renewalId ?? ''));
    expect(reminder?.status).toBe('CANCELLED');
    // A refund leaves nothing to give back.
    expect(report.plansToCheck).toEqual([
      expect.objectContaining({
        subscriptionId,
        organizationId: null,
        payerAccountId: traveller,
        endedPlanKey: 'traveller_plus_restore',
        reason: 'refunded',
        planNow: null,
        planOnPreIncidentBranch: null,
        needsAction: false,
      }),
    ]);
    // Ids and plan keys only: never a name or an email.
    expect(JSON.stringify(report.plansToCheck)).not.toContain('@');
  });

  it('never copies a plan ending nobody recorded (for example one the incident itself caused)', async () => {
    const organizationId = await activeAgency();
    const restored = await restoredBranch();
    const restorePoint = await restorePointNow();
    // A bad run on the pre-incident branch ends the plan without any record of a decision.
    await db.execute(
      sql`update subscriptions set ended_at = now() where organization_id = ${organizationId}::uuid`,
    );
    const report = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(report.errors).toEqual([]);
    expect(await currentPlans(restored, organizationId)).toHaveLength(1);
    expect(report.plansToCheck).toEqual([]);
  });

  it('leaves plans ended before the restore point as they are', async () => {
    const organizationId = await activeAgency();
    await activateSubscription(db, {
      actor: { accountId: platformOwner, email: OWNER_EMAIL, bootstrapEmails: [] },
      stepUpSatisfied: true,
      organizationId,
      planId: await agencyPlan('agency_earlier_restore'),
      reason: 'earlier',
    });
    const restored = await restoredBranch();
    const restorePoint = await restorePointNow();
    const report = await reconcileRestoredBranch(db, restored, restorePoint);
    expect(report.errors).toEqual([]);
    expect(report.plansToCheck).toEqual([]);
    expect(report.counts.subscriptionsEnded).toBe(0);
  });
});
