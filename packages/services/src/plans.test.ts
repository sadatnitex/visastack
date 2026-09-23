import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import {
  addMembership,
  createOrganization,
  reviewOrganization,
  setMembershipActive,
} from './organizations';
import {
  TRAVELLER_FREE_PLAN_KEY,
  activateSubscription,
  cancelScheduledDowngrade,
  createPlan,
  endSubscription,
  executeScheduledDowngrade,
  getCurrentPlanForOrganization,
  getPendingDowngradeForOrganization,
  getPlanByKey,
  getUsageForOrganization,
  listDueDowngrades,
  listPlans,
  scheduleDowngrade,
  updatePlan,
} from './plans';
import { grantPlatformRole } from './platform-roles';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

/** A bootstrapped platform owner, the actor every admin-gated plans.ts function needs. */
async function seedPlatformOwner(db: Db, tag: string) {
  const p = await provisionAccount(db, { email: `owner-${tag}@platform.example.com` });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  const granted = await grantPlatformRole(db, {
    actor: { accountId: account.id, email: account.email, bootstrapEmails: [account.email] },
    targetAccountId: account.id,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return {
    accountId: account.id,
    actor: { accountId: account.id, email: account.email, bootstrapEmails: [] as string[] },
  };
}

/** A verified organization with one OWNER member, ready to receive a subscription. */
async function seedOrganization(db: Db, tag: string) {
  const ownerAcc = await provisionAccount(db, { email: `org-owner-${tag}@acme.com` });
  if (!isOk(ownerAcc)) throw new Error('provision');
  const org = await createOrganization(db, {
    actorAccountId: ownerAcc.value.id,
    name: `Acme ${tag}`,
  });
  if (!isOk(org)) throw new Error('org');
  await activateOrg(db, org.value.id);
  return { organizationId: org.value.id, ownerAccountId: ownerAcc.value.id };
}

describe('plans - catalog CRUD (COM-01)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'catalog');
  });

  it('seeds exactly the three PRD-named templates, each with entitlements as real data, never price/currency invented', async () => {
    const plans = await listPlans(db);
    const byKey = new Map(plans.map((p) => [p.key, p]));
    expect(byKey.has('traveller_free')).toBe(true);
    expect(byKey.has('agency_starter')).toBe(true);
    expect(byKey.has('agency_pro')).toBe(true);
    for (const plan of plans) {
      // "Numerical allowances/prices are product-owner configuration, not
      // invented market truth" -- no seeded row invents a price.
      expect(plan.priceMinorUnits).toBeNull();
      expect(plan.currency).toBeNull();
      expect(plan.active).toBe(true);
    }
    const free = byKey.get('traveller_free');
    expect(free?.seatsAllowed).toBe(1);
    // Traveller Free's storage figure reuses the currently-enforced
    // QUOTA_MAX_ACCOUNT_EVIDENCE_MB default (100 MB), not an invented number.
    expect(free?.storageBytesAllowed).toBe(100 * 1024 * 1024);
  });

  it('getPlanByKey finds the seeded Traveller Free plan by its exported key constant', async () => {
    const plan = await getPlanByKey(db, TRAVELLER_FREE_PLAN_KEY);
    expect(plan?.key).toBe(TRAVELLER_FREE_PLAN_KEY);
  });

  it('createPlan refuses a non-owner, even an active member of some organization', async () => {
    const stranger = await provisionAccount(db, { email: 'stranger-plan@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const result = await createPlan(db, {
      actor: {
        accountId: stranger.value.id,
        email: 'stranger-plan@example.com',
        bootstrapEmails: [],
      },
      stepUpSatisfied: true,
      key: 'agency_enterprise',
      name: 'Agency Enterprise',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('createPlan refuses without step-up, even for a genuine platform owner', async () => {
    const result = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: false,
      key: 'agency_enterprise',
      name: 'Agency Enterprise',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('step_up_required');
  });

  it('createPlan refuses a negative entitlement, a non-positive periodDays, and a duplicate key', async () => {
    const negative = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      key: 'agency_enterprise',
      name: 'Agency Enterprise',
      seatsAllowed: -1,
    });
    expect(isErr(negative)).toBe(true);
    if (isErr(negative)) expect(negative.error.code).toBe('invalid');

    const zeroPeriod = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      key: 'agency_enterprise',
      name: 'Agency Enterprise',
      periodDays: 0,
    });
    expect(isErr(zeroPeriod)).toBe(true);

    const duplicate = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      key: 'agency_pro',
      name: 'Another Pro',
    });
    expect(isErr(duplicate)).toBe(true);
    if (isErr(duplicate)) expect(duplicate.error.code).toBe('invalid');
  });

  it('createPlan refuses a price without a currency, and a currency without a price', async () => {
    const priceOnly = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      key: 'agency_enterprise',
      name: 'Agency Enterprise',
      priceMinorUnits: 10000,
    });
    expect(isErr(priceOnly)).toBe(true);

    const currencyOnly = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      key: 'agency_enterprise',
      name: 'Agency Enterprise',
      currency: 'USD',
    });
    expect(isErr(currencyOnly)).toBe(true);
  });

  it('creates a real plan with both price and currency set together, audited', async () => {
    const created = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      key: 'agency_enterprise',
      name: 'Agency Enterprise',
      seatsAllowed: 100,
      priceMinorUnits: 99900,
      currency: 'USD',
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    expect(created.value.priceMinorUnits).toBe(99900);
    expect(created.value.currency).toBe('USD');

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PLAN_CREATED'));
    expect(events).toHaveLength(1);
  });

  it('updatePlan only touches fields explicitly passed, auditing before/after for each changed field', async () => {
    const pro = await getPlanByKey(db, 'agency_pro');
    if (!pro) throw new Error('seed');
    const originalSeats = pro.seatsAllowed;

    const updated = await updatePlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      planId: pro.id,
      concurrentOpenCasesAllowed: 999,
    });
    expect(isOk(updated)).toBe(true);
    if (isOk(updated)) {
      expect(updated.value.concurrentOpenCasesAllowed).toBe(999);
      expect(updated.value.seatsAllowed).toBe(originalSeats); // untouched
      expect(updated.value.name).toBe(pro.name); // untouched
    }

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PLAN_UPDATED'));
    expect(events).toHaveLength(1);
  });

  it('updatePlan refuses to leave price set without currency via a partial update touching only one of the two', async () => {
    // agency_pro seeds with both null; setting only priceMinorUnits would
    // leave currency null underneath it.
    const pro = await getPlanByKey(db, 'agency_pro');
    if (!pro) throw new Error('seed');
    const result = await updatePlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      planId: pro.id,
      priceMinorUnits: 5000,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('updatePlan can retire a plan (active: false) without deleting it', async () => {
    const pro = await getPlanByKey(db, 'agency_pro');
    if (!pro) throw new Error('seed');
    const retired = await updatePlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      planId: pro.id,
      active: false,
    });
    expect(isOk(retired)).toBe(true);
    if (isOk(retired)) expect(retired.value.active).toBe(false);

    const stillListed = await listPlans(db);
    expect(stillListed.some((p) => p.key === 'agency_pro')).toBe(true);
    const activeOnly = await listPlans(db, { activeOnly: true });
    expect(activeOnly.some((p) => p.key === 'agency_pro')).toBe(false);
  });

  it('updatePlan returns not_found for an unknown planId', async () => {
    const result = await updatePlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      planId: '00000000-0000-0000-0000-000000000000',
      name: 'x',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('not_found');
  });
});

describe('subscriptions - manual plan activation (COM-01)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'sub');
  });

  it('an organization has no current plan at all until one is manually activated -- never a silent free-tier fallback', async () => {
    const { organizationId } = await seedOrganization(db, 'none');
    const plan = await getCurrentPlanForOrganization(db, organizationId);
    expect(plan).toBeUndefined();
  });

  it('activateSubscription refuses a non-owner and requires step-up', async () => {
    const { organizationId } = await seedOrganization(db, 'auth');
    const starter = await getPlanByKey(db, 'agency_starter');
    if (!starter) throw new Error('seed');
    const stranger = await provisionAccount(db, { email: 'stranger-sub@example.com' });
    if (!isOk(stranger)) throw new Error('provision');

    const byStranger = await activateSubscription(db, {
      actor: {
        accountId: stranger.value.id,
        email: 'stranger-sub@example.com',
        bootstrapEmails: [],
      },
      stepUpSatisfied: true,
      organizationId,
      planId: starter.id,
      reason: 'test',
    });
    expect(isErr(byStranger)).toBe(true);
    if (isErr(byStranger)) expect(byStranger.error.code).toBe('forbidden');

    const noStepUp = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: false,
      organizationId,
      planId: starter.id,
      reason: 'test',
    });
    expect(isErr(noStepUp)).toBe(true);
    if (isErr(noStepUp)) expect(noStepUp.error.code).toBe('step_up_required');
  });

  it('requires a non-empty reason, and refuses an unknown organization or plan', async () => {
    const { organizationId } = await seedOrganization(db, 'valid');
    const starter = await getPlanByKey(db, 'agency_starter');
    if (!starter) throw new Error('seed');

    const noReason = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: starter.id,
      reason: '   ',
    });
    expect(isErr(noReason)).toBe(true);
    if (isErr(noReason)) expect(noReason.error.code).toBe('invalid');

    const badOrg = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: '00000000-0000-0000-0000-000000000000',
      planId: starter.id,
      reason: 'test',
    });
    expect(isErr(badOrg)).toBe(true);
    if (isErr(badOrg)) expect(badOrg.error.code).toBe('not_found');

    const badPlan = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: '00000000-0000-0000-0000-000000000000',
      reason: 'test',
    });
    expect(isErr(badPlan)).toBe(true);
    if (isErr(badPlan)) expect(badPlan.error.code).toBe('not_found');
  });

  it('refuses to newly assign a retired (inactive) plan', async () => {
    const { organizationId } = await seedOrganization(db, 'retired');
    const pro = await getPlanByKey(db, 'agency_pro');
    if (!pro) throw new Error('seed');
    const retired = await updatePlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      planId: pro.id,
      active: false,
    });
    if (!isOk(retired)) throw new Error('retire');

    const attempt = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: pro.id,
      reason: 'test',
    });
    expect(isErr(attempt)).toBe(true);
    if (isErr(attempt)) expect(attempt.error.code).toBe('invalid');
  });

  it('activates a real subscription, auditable and immediately current', async () => {
    const { organizationId } = await seedOrganization(db, 'activate');
    const starter = await getPlanByKey(db, 'agency_starter');
    if (!starter) throw new Error('seed');

    const activated = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: starter.id,
      reason: 'onboarding agency',
    });
    expect(isOk(activated)).toBe(true);
    if (isOk(activated)) {
      expect(activated.value.endedAt).toBeNull();
      expect(activated.value.assignedByAccountId).toBe(owner.accountId);
      expect(activated.value.reason).toBe('onboarding agency');
    }

    const current = await getCurrentPlanForOrganization(db, organizationId);
    expect(current?.key).toBe('agency_starter');

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'SUBSCRIPTION_ACTIVATED'));
    expect(events).toHaveLength(1);
  });

  it('a plan change ends the prior subscription and starts a new one atomically -- real history, never an overwrite, and never more than one current row', async () => {
    const { organizationId } = await seedOrganization(db, 'change');
    const starter = await getPlanByKey(db, 'agency_starter');
    const pro = await getPlanByKey(db, 'agency_pro');
    if (!starter || !pro) throw new Error('seed');

    const first = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: starter.id,
      reason: 'initial',
    });
    if (!isOk(first)) throw new Error('activate');

    const second = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: pro.id,
      reason: 'upgrade',
    });
    expect(isOk(second)).toBe(true);

    const rows = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, organizationId));
    expect(rows).toHaveLength(2);
    const currentRows = rows.filter((r) => r.endedAt === null);
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]?.planId).toBe(pro.id);
    const endedRow = rows.find((r) => r.id === first.value.id);
    expect(endedRow?.endedAt).not.toBeNull();

    const current = await getCurrentPlanForOrganization(db, organizationId);
    expect(current?.key).toBe('agency_pro');
  });

  it('endSubscription is idempotent when nothing is currently active, and genuinely ends a current one', async () => {
    const { organizationId } = await seedOrganization(db, 'end');
    const noop = await endSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'nothing to end',
    });
    expect(isOk(noop)).toBe(true);
    if (isOk(noop)) expect(noop.value.ended).toBe(false);

    const starter = await getPlanByKey(db, 'agency_starter');
    if (!starter) throw new Error('seed');
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: starter.id,
      reason: 'activate',
    });

    const ended = await endSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'non-payment',
    });
    expect(isOk(ended)).toBe(true);
    if (isOk(ended)) expect(ended.value.ended).toBe(true);

    const current = await getCurrentPlanForOrganization(db, organizationId);
    expect(current).toBeUndefined();
  });
});

describe('scheduled downgrades -- effective dates, warning, grace (COM-02)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'downgrade');
  });

  async function makePlan(tag: string, seatsAllowed: number) {
    const created = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      key: `test-plan-${tag}`,
      name: `Test Plan ${tag}`,
      seatsAllowed,
    });
    if (!isOk(created)) throw new Error('plan');
    return created.value;
  }

  it('refuses a non-owner and requires step-up', async () => {
    const { organizationId } = await seedOrganization(db, 'auth');
    const generous = await makePlan('auth-generous', 5);
    const tight = await makePlan('auth-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: generous.id,
      reason: 'setup',
    });
    const stranger = await provisionAccount(db, { email: 'stranger-downgrade@example.com' });
    if (!isOk(stranger)) throw new Error('provision');

    const byStranger = await scheduleDowngrade(db, {
      actor: {
        accountId: stranger.value.id,
        email: 'stranger-downgrade@example.com',
        bootstrapEmails: [],
      },
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
    });
    expect(isErr(byStranger)).toBe(true);
    if (isErr(byStranger)) expect(byStranger.error.code).toBe('forbidden');

    const noStepUp = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: false,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
    });
    expect(isErr(noStepUp)).toBe(true);
    if (isErr(noStepUp)) expect(noStepUp.error.code).toBe('step_up_required');
  });

  it('requires a non-empty reason, refuses an unknown organization or plan, and refuses a retired target plan', async () => {
    const { organizationId } = await seedOrganization(db, 'valid');
    const generous = await makePlan('valid-generous', 5);
    const tight = await makePlan('valid-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: generous.id,
      reason: 'setup',
    });

    const noReason = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: '   ',
    });
    expect(isErr(noReason)).toBe(true);
    if (isErr(noReason)) expect(noReason.error.code).toBe('invalid');

    const badOrg = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: '00000000-0000-0000-0000-000000000000',
      toPlanId: tight.id,
      reason: 'test',
    });
    expect(isErr(badOrg)).toBe(true);
    if (isErr(badOrg)) expect(badOrg.error.code).toBe('not_found');

    const badPlan = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: '00000000-0000-0000-0000-000000000000',
      reason: 'test',
    });
    expect(isErr(badPlan)).toBe(true);
    if (isErr(badPlan)) expect(badPlan.error.code).toBe('not_found');

    const retired = await updatePlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      planId: tight.id,
      active: false,
    });
    if (!isOk(retired)) throw new Error('retire');
    const toRetired = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
    });
    expect(isErr(toRetired)).toBe(true);
    if (isErr(toRetired)) expect(toRetired.error.code).toBe('invalid');
  });

  it('refuses when the organization has no current subscription to downgrade from', async () => {
    const { organizationId } = await seedOrganization(db, 'noplan');
    const tight = await makePlan('noplan-tight', 1);
    const result = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('refuses a target plan that is not actually a downgrade on every dimension', async () => {
    const { organizationId } = await seedOrganization(db, 'notdown');
    const current = await makePlan('notdown-current', 2);
    const moreGenerous = await makePlan('notdown-more', 10);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: current.id,
      reason: 'setup',
    });
    const result = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: moreGenerous.id,
      reason: 'test',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('refuses an effectiveAt that is not in the future', async () => {
    const { organizationId } = await seedOrganization(db, 'pastdate');
    const current = await makePlan('pastdate-current', 5);
    const tight = await makePlan('pastdate-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: current.id,
      reason: 'setup',
    });
    const now = new Date();
    const result = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
      effectiveAt: now,
      now,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('schedules a real downgrade, audited, defaulting effectiveAt to 14 days out, and warns the org owner on both channels', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'schedule');
    const current = await makePlan('schedule-current', 5);
    const tight = await makePlan('schedule-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: current.id,
      reason: 'setup',
    });
    const now = new Date();

    const scheduled = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'annual review',
      now,
    });
    expect(isOk(scheduled)).toBe(true);
    if (!isOk(scheduled)) return;
    expect(scheduled.value.status).toBe('PENDING');
    expect(scheduled.value.fromPlanId).toBe(current.id);
    expect(scheduled.value.toPlanId).toBe(tight.id);
    const expectedEffective = now.getTime() + 14 * 24 * 60 * 60 * 1000;
    expect(scheduled.value.effectiveAt.getTime()).toBe(expectedEffective);

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOWNGRADE_SCHEDULED'));
    expect(events).toHaveLength(1);

    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'DOWNGRADE_SCHEDULED'));
    expect(notifications).toHaveLength(2); // IN_APP + EMAIL
    expect(notifications.every((n) => n.recipientAccountId === ownerAccountId)).toBe(true);

    // Grace holds: the organization's current plan has NOT changed yet.
    const current2 = await getCurrentPlanForOrganization(db, organizationId);
    expect(current2?.id).toBe(current.id);
  });

  it('refuses a second schedule while one is already pending', async () => {
    const { organizationId } = await seedOrganization(db, 'double');
    const current = await makePlan('double-current', 5);
    const tight = await makePlan('double-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: current.id,
      reason: 'setup',
    });
    const first = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'first',
    });
    expect(isOk(first)).toBe(true);

    const second = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'second',
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });

  it('cancelScheduledDowngrade is idempotent once cancelled, refuses once executed, and requires owner + step-up', async () => {
    const { organizationId } = await seedOrganization(db, 'cancel');
    const current = await makePlan('cancel-current', 5);
    const tight = await makePlan('cancel-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: current.id,
      reason: 'setup',
    });
    const scheduled = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
    });
    if (!isOk(scheduled)) throw new Error('schedule');

    const stranger = await provisionAccount(db, { email: 'stranger-cancel@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const byStranger = await cancelScheduledDowngrade(db, {
      actor: {
        accountId: stranger.value.id,
        email: 'stranger-cancel@example.com',
        bootstrapEmails: [],
      },
      stepUpSatisfied: true,
      downgradeId: scheduled.value.id,
      reason: 'test',
    });
    expect(isErr(byStranger)).toBe(true);
    if (isErr(byStranger)) expect(byStranger.error.code).toBe('forbidden');

    const noStepUp = await cancelScheduledDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: false,
      downgradeId: scheduled.value.id,
      reason: 'test',
    });
    expect(isErr(noStepUp)).toBe(true);
    if (isErr(noStepUp)) expect(noStepUp.error.code).toBe('step_up_required');

    const cancelled = await cancelScheduledDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      downgradeId: scheduled.value.id,
      reason: 'changed our minds',
    });
    expect(isOk(cancelled)).toBe(true);
    if (isOk(cancelled)) expect(cancelled.value.status).toBe('CANCELLED');

    // Idempotent: cancelling again returns the same cancelled row, not an error.
    const cancelledAgain = await cancelScheduledDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      downgradeId: scheduled.value.id,
      reason: 'once more',
    });
    expect(isOk(cancelledAgain)).toBe(true);
    if (isOk(cancelledAgain)) expect(cancelledAgain.value.status).toBe('CANCELLED');

    expect(await getPendingDowngradeForOrganization(db, organizationId)).toBeUndefined();

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOWNGRADE_CANCELLED'));
    expect(events).toHaveLength(1);
  });

  it('listDueDowngrades returns only PENDING rows whose effectiveAt has arrived', async () => {
    const { organizationId: orgA } = await seedOrganization(db, 'due-a');
    const { organizationId: orgB } = await seedOrganization(db, 'due-b');
    const current = await makePlan('due-current', 5);
    const tight = await makePlan('due-tight', 1);
    for (const organizationId of [orgA, orgB]) {
      await activateSubscription(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        organizationId,
        planId: current.id,
        reason: 'setup',
      });
    }
    const now = new Date();
    const soon = new Date(now.getTime() + 60_000);
    const farFuture = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const dueSoon = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: orgA,
      toPlanId: tight.id,
      reason: 'due',
      effectiveAt: soon,
      now,
    });
    const notDue = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: orgB,
      toPlanId: tight.id,
      reason: 'not due',
      effectiveAt: farFuture,
      now,
    });
    if (!isOk(dueSoon) || !isOk(notDue)) throw new Error('schedule');

    const checkTime = new Date(now.getTime() + 120_000); // past `soon`, well before `farFuture`
    const due = await listDueDowngrades(db, checkTime);
    expect(due.map((d) => d.id)).toEqual([dueSoon.value.id]);
  });

  it('executeScheduledDowngrade refuses before the effective date, then applies the plan change and blocks new capacity once it is due -- proving grace holds and then lifts', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'execute');
    const generous = await makePlan('execute-generous', 5);
    const tight = await makePlan('execute-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: generous.id,
      reason: 'setup',
    });

    const now = new Date();
    const effectiveAt = new Date(now.getTime() + 60_000);
    const scheduled = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'right-sizing',
      effectiveAt,
      now,
    });
    if (!isOk(scheduled)) throw new Error('schedule');

    // During grace: still on the generous plan, a second seat is fine.
    const memberDuringGrace = await provisionAccount(db, { email: 'grace-member@acme.com' });
    if (!isOk(memberDuringGrace)) throw new Error('provision');
    const addedDuringGrace = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: memberDuringGrace.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(addedDuringGrace)).toBe(true);

    // Too early -- the effective date has not arrived.
    const tooEarly = await executeScheduledDowngrade(db, {
      downgradeId: scheduled.value.id,
      now,
    });
    expect(isErr(tooEarly)).toBe(true);
    if (isErr(tooEarly)) expect(tooEarly.error.code).toBe('invalid');

    // Due now.
    const executed = await executeScheduledDowngrade(db, {
      downgradeId: scheduled.value.id,
      now: effectiveAt,
    });
    expect(isOk(executed)).toBe(true);
    if (isOk(executed)) expect(executed.value.status).toBe('EXECUTED');

    const currentPlan = await getCurrentPlanForOrganization(db, organizationId);
    expect(currentPlan?.id).toBe(tight.id);

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOWNGRADE_EXECUTED'));
    expect(events).toHaveLength(1);
    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'DOWNGRADE_EXECUTED'));
    expect(notifications).toHaveLength(2);

    // After grace: the org already has 2 active seats (owner + the member
    // added during grace) -- the new 1-seat cap refuses a third, "deletes
    // nothing" (both existing members are still active), and this is the
    // exact real call site (addMembership), never the internal check
    // function directly.
    const thirdMember = await provisionAccount(db, { email: 'post-grace-member@acme.com' });
    if (!isOk(thirdMember)) throw new Error('provision');
    const blockedAfterGrace = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: thirdMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isErr(blockedAfterGrace)).toBe(true);
    if (isErr(blockedAfterGrace)) expect(blockedAfterGrace.error.code).toBe('invalid');

    const stillActiveMembers = await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, organizationId),
          eq(schema.memberships.active, true),
        ),
      );
    expect(stillActiveMembers).toHaveLength(2); // deletes nothing
  });

  it('executeScheduledDowngrade returns not_found once nothing is PENDING for that id', async () => {
    const { organizationId } = await seedOrganization(db, 'missing');
    const current = await makePlan('missing-current', 5);
    const tight = await makePlan('missing-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: current.id,
      reason: 'setup',
    });
    const scheduled = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
      effectiveAt: new Date(Date.now() + 1000),
    });
    if (!isOk(scheduled)) throw new Error('schedule');
    const cancelled = await cancelScheduledDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      downgradeId: scheduled.value.id,
      reason: 'test',
    });
    if (!isOk(cancelled)) throw new Error('cancel');

    const result = await executeScheduledDowngrade(db, {
      downgradeId: scheduled.value.id,
      now: new Date(Date.now() + 10_000),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('not_found');
  });

  it('activateSubscription auto-cancels a PENDING scheduled downgrade it supersedes', async () => {
    const { organizationId } = await seedOrganization(db, 'supersede-activate');
    const current = await makePlan('supersede-activate-current', 5);
    const tight = await makePlan('supersede-activate-tight', 1);
    const another = await makePlan('supersede-activate-another', 3);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: current.id,
      reason: 'setup',
    });
    const scheduled = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
    });
    if (!isOk(scheduled)) throw new Error('schedule');

    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: another.id,
      reason: 'admin correction',
    });

    expect(await getPendingDowngradeForOrganization(db, organizationId)).toBeUndefined();
    const rows = await db
      .select()
      .from(schema.scheduledDowngrades)
      .where(eq(schema.scheduledDowngrades.id, scheduled.value.id));
    expect(rows[0]?.status).toBe('CANCELLED');
    expect(rows[0]?.cancelledReason).toBe('superseded by an immediate plan change');
  });

  it('endSubscription auto-cancels a PENDING scheduled downgrade it supersedes', async () => {
    const { organizationId } = await seedOrganization(db, 'supersede-end');
    const current = await makePlan('supersede-end-current', 5);
    const tight = await makePlan('supersede-end-tight', 1);
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: current.id,
      reason: 'setup',
    });
    const scheduled = await scheduleDowngrade(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toPlanId: tight.id,
      reason: 'test',
    });
    if (!isOk(scheduled)) throw new Error('schedule');

    await endSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'churned',
    });

    expect(await getPendingDowngradeForOrganization(db, organizationId)).toBeUndefined();
    const rows = await db
      .select()
      .from(schema.scheduledDowngrades)
      .where(eq(schema.scheduledDowngrades.id, scheduled.value.id));
    expect(rows[0]?.status).toBe('CANCELLED');
  });
});

describe('getUsageForOrganization - meters and their definitions (COM-01)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'usage');
  });

  it('refuses a caller who is not an active member of the organization', async () => {
    const { organizationId } = await seedOrganization(db, 'gate');
    const stranger = await provisionAccount(db, { email: 'stranger-usage@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const result = await getUsageForOrganization(db, {
      actorAccountId: stranger.value.id,
      organizationId,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('reports planAssigned: false and every meter allowed: null when no plan has been activated, with real usage still shown', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'noplan');
    const result = await getUsageForOrganization(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.planAssigned).toBe(false);
    expect(result.value.plan).toBeUndefined();
    for (const meter of result.value.meters) {
      expect(meter.allowed).toBeNull();
      expect(meter.definition.length).toBeGreaterThan(0);
    }
    // One active seat -- the org owner themselves -- even with no plan.
    const seats = result.value.meters.find((m) => m.key === 'seats');
    expect(seats?.used).toBe(1);
  });

  it('active-seats meter counts only active memberships, excluding a deactivated one', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'seats');
    const member = await provisionAccount(db, { email: 'member-seats@acme.com' });
    if (!isOk(member)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: member.value.id,
      role: 'CASE_MANAGER',
    });
    if (!isOk(added)) throw new Error('member');

    const withTwo = await getUsageForOrganization(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    if (!isOk(withTwo)) throw new Error('usage');
    expect(withTwo.value.meters.find((m) => m.key === 'seats')?.used).toBe(2);

    await setMembershipActive(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      membershipId: added.value.id,
      active: false,
    });
    const withOne = await getUsageForOrganization(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    if (!isOk(withOne)) throw new Error('usage');
    expect(withOne.value.meters.find((m) => m.key === 'seats')?.used).toBe(1);
  });

  it('cases-per-period and concurrent-open-cases meters count only missions attributed to this org (ownerOrganizationId), excluding a case outside the trailing period window and excluding CLOSED/CANCELLED from concurrent-open', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'cases');
    const traveller = await provisionAccount(db, { email: 'traveller-cases@example.com' });
    if (!isOk(traveller)) throw new Error('provision');
    await setConsent(db, {
      actorAccountId: traveller.value.id,
      accountId: traveller.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: traveller.value.id,
      ownerAccountId: traveller.value.id,
      displayName: 'Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant');

    const recentOpen = await createMission(db, {
      actorAccountId: traveller.value.id,
      applicantId: applicant.value.id,
      title: 'Recent open case',
      ownerOrganizationId: organizationId,
    });
    const recentClosed = await createMission(db, {
      actorAccountId: traveller.value.id,
      applicantId: applicant.value.id,
      title: 'Recent closed case',
      ownerOrganizationId: organizationId,
    });
    const unattributed = await createMission(db, {
      actorAccountId: traveller.value.id,
      applicantId: applicant.value.id,
      title: 'Not this org',
    });
    if (!isOk(recentOpen) || !isOk(recentClosed) || !isOk(unattributed)) throw new Error('mission');

    await db
      .update(schema.missions)
      .set({ state: 'CLOSED' })
      .where(eq(schema.missions.id, recentClosed.value.id));

    // A case created well before the plan's trailing period window --
    // Agency Starter has periodDays=30, so backdate this one 60 days.
    const starter = await getPlanByKey(db, 'agency_starter');
    if (!starter) throw new Error('seed');
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: starter.id,
      reason: 'test',
    });
    const oldCase = await createMission(db, {
      actorAccountId: traveller.value.id,
      applicantId: applicant.value.id,
      title: 'Old case',
      ownerOrganizationId: organizationId,
    });
    if (!isOk(oldCase)) throw new Error('mission');
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.missions)
      .set({ createdAt: sixtyDaysAgo })
      .where(eq(schema.missions.id, oldCase.value.id));

    const usage = await getUsageForOrganization(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      now: new Date(),
    });
    if (!isOk(usage)) throw new Error('usage');

    // casesPerPeriod: recentOpen + recentClosed count (created in-window,
    // regardless of current state); oldCase (60 days back) and the
    // unattributed mission do not.
    expect(usage.value.meters.find((m) => m.key === 'casesPerPeriod')?.used).toBe(2);
    // concurrentOpenCases: only recentOpen -- recentClosed is CLOSED,
    // oldCase (though open) falls outside no window restriction for this
    // meter but IS attributed and OPEN, so it counts too; unattributed does not.
    expect(usage.value.meters.find((m) => m.key === 'concurrentOpenCases')?.used).toBe(2);
    expect(usage.value.meters.find((m) => m.key === 'casesPerPeriod')?.allowed).toBe(
      starter.casesPerPeriodAllowed,
    );
  });

  it('storage and AI-allowance meters reuse the grant-based "applicants this org can access" definition, distinct from case ownership', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'storage');
    const usage = await getUsageForOrganization(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(usage)).toBe(true);
    if (!isOk(usage)) return;
    // No grants exist yet -- zero storage/AI usage, not an error.
    expect(usage.value.meters.find((m) => m.key === 'storageBytes')?.used).toBe(0);
    expect(usage.value.meters.find((m) => m.key === 'aiAllowanceUnits')?.used).toBe(0);
  });
});
