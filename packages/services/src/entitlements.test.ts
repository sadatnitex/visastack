import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { staffPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { aiEntitlementFor } from './ai-feature-settings';
import { openBillingAccount, transitionBillingStatus } from './billing';
import { runBillingCycle } from './billing-cycle';
import { grantCommercialOverride } from './commercial-override';
import type { Db } from './db';
import { checkSeatEntitlement } from './entitlement-enforcement';
import { resolveEntitlements } from './entitlements';
import { createOrganization, reviewOrganization } from './organizations';
import {
  activateSubscription,
  getPlanByKey,
  getUsageForOrganization,
  scheduleDowngrade,
} from './plans';
import { type PlanDraft, listPlansForAdmin, retirePlan, savePlan } from './plans-admin';
import { grantPlatformRole } from './platform-roles';

/**
 * S29: one entitlement resolver (override, then a plan that lifts every limit, then suspension,
 * then the plan's numbers) and the Plans page services (create, edit, price from the next billing
 * period, retire), audited and owner only.
 */

const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT = 120_000;

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const created = await provisionAccount(db, { email });
  if (!isOk(created)) throw new Error('provision');
  return created.value.id;
}

const OWNER_EMAIL = 'owner-plans@platform.example.com';

describe('the entitlement resolver and the Plans page (S29)', () => {
  let db: Db;
  let ownerId: string;
  const actor = () => ({ accountId: ownerId, email: OWNER_EMAIL, bootstrapEmails: [] as string[] });

  beforeEach(async () => {
    db = await freshDb();
    ownerId = await account(db, OWNER_EMAIL);
    const granted = await grantPlatformRole(db, {
      actor: { accountId: ownerId, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
      targetAccountId: ownerId,
      role: 'PLATFORM_OWNER',
      reason: 'seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
  });

  async function plansScope() {
    const minted = await staffPrincipal(
      db,
      { accountId: ownerId, email: OWNER_EMAIL, bootstrapEmails: [] },
      'PLANS_MANAGE',
    );
    if (!isOk(minted)) throw new Error('scope');
    return minted.value;
  }

  async function agency(tag: string) {
    const agencyOwner = await account(db, `owner-${tag}@acme.example.com`);
    const org = await createOrganization(db, { actorAccountId: agencyOwner, name: `Acme ${tag}` });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await account(db, `reviewer-${tag}@platform.example.com`);
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review');
    return { organizationId: org.value.id, agencyOwner };
  }

  const draft = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
    name: 'Agency Growth',
    periodDays: 30,
    price: { priceMinorUnits: 250_000, currency: 'BDT' },
    rules: {
      seats: { included: true, limit: 1 },
      invitations: { included: true, limit: 1 },
      cases_per_period: { included: true, limit: 50 },
      open_cases: { included: true, limit: null },
      storage_bytes: { included: true, limit: 1_073_741_824 },
      ai_allowance_units: { included: true, limit: null },
    },
    ...overrides,
  });

  async function newPlan(overrides: Partial<PlanDraft> = {}): Promise<string> {
    const saved = await savePlan(db, await plansScope(), {
      draft: draft(overrides),
      stepUpSatisfied: true,
    });
    if (!isOk(saved)) throw new Error(`plan: ${saved.error.message}`);
    return saved.value.planId;
  }

  async function putOn(organizationId: string, planId: string) {
    const done = await activateSubscription(db, {
      actor: actor(),
      stepUpSatisfied: true,
      organizationId,
      planId,
      reason: 'test',
    });
    if (!isOk(done)) throw new Error(`subscription: ${done.error.message}`);
  }

  async function suspend(organizationId: string) {
    const opened = await openBillingAccount(db, {
      actor: actor(),
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'onboarding',
    });
    if (!isOk(opened)) throw new Error('billing account');
    const moved = await transitionBillingStatus(db, {
      actor: actor(),
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'SUSPENDED',
      reason: 'non-payment',
    });
    if (!isOk(moved)) throw new Error('suspend');
  }

  it(
    'decides in the order override, then lifted limits, then suspension, then the plan',
    async () => {
      const { organizationId } = await agency('order');
      // A new agency is on Founding Access: every limit lifted (not by its key, by its flag).
      let resolved = await resolveEntitlements(db, { organizationId });
      expect(resolved.gate).toBe('bypass');
      expect(resolved.bypassLimits).toBe(true);
      expect(resolved.source).toBe('entitlements');

      // Suspended on Founding Access: the lifted limits still win (as before S29).
      await suspend(organizationId);
      resolved = await resolveEntitlements(db, { organizationId });
      expect(resolved.gate).toBe('bypass');
      expect(isOk(await db.transaction((tx) => checkSeatEntitlement(tx, organizationId)))).toBe(
        true,
      );

      // On a plan with limits while suspended: suspension decides.
      const planId = await newPlan();
      await putOn(organizationId, planId);
      resolved = await resolveEntitlements(db, { organizationId });
      expect(resolved.gate).toBe('suspended');
      expect(resolved.limits.seats).toBe(1);
      const refused = await db.transaction((tx) => checkSeatEntitlement(tx, organizationId));
      expect(isErr(refused) && refused.error.reason).toBe('billing_suspended');

      // An override outranks the suspension.
      const override = await grantCommercialOverride(db, {
        actor: actor(),
        stepUpSatisfied: true,
        organizationId,
        reason: 'pilot',
        durationDays: 7,
      });
      expect(isOk(override)).toBe(true);
      resolved = await resolveEntitlements(db, { organizationId });
      expect(resolved.gate).toBe('override');
      expect(resolved.override?.until.getTime()).toBeGreaterThan(Date.now());
    },
    TIMEOUT,
  );

  it(
    'gives no limits to an agency without a plan, and reads limits from the plan rules',
    async () => {
      const { organizationId } = await agency('rules');
      await db
        .update(schema.subscriptions)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(schema.subscriptions.organizationId, organizationId),
            isNull(schema.subscriptions.endedAt),
          ),
        );
      let resolved = await resolveEntitlements(db, { organizationId });
      expect(resolved.plan).toBeNull();
      expect(Object.values(resolved.limits).every((v) => v === null)).toBe(true);

      const planId = await newPlan({
        rules: {
          seats: { included: true, limit: 4 },
          invitations: { included: true, limit: 6 },
          'ai.ai_app_suggestions': { included: true, limit: 3 },
        },
      });
      await putOn(organizationId, planId);
      resolved = await resolveEntitlements(db, { organizationId });
      expect(resolved.gate).toBe('plan');
      expect(resolved.limits.seats).toBe(4);
      expect(resolved.limits.invitations).toBe(6);
      expect(resolved.features.ai_app_suggestions).toEqual({ included: true, dailyLimit: 3 });
      expect(resolved.features.ai_app_original_files.included).toBe(false);
      // The old columns follow the rules (code before S29 reads them).
      const [row] = await db
        .select({ seats: schema.plans.seatsAllowed })
        .from(schema.plans)
        .where(eq(schema.plans.id, planId));
      expect(row?.seats).toBe(4);
      const usage = await getUsageForOrganization(db, {
        actorAccountId: ownerId,
        actorEmail: OWNER_EMAIL,
        organizationId,
      });
      if (!isOk(usage)) throw new Error('usage');
      expect(usage.value.meters.find((m) => m.key === 'invitations')?.allowed).toBe(6);
      expect(usage.value.meters.find((m) => m.key === 'seats')?.label).toBe('Team Members');
    },
    TIMEOUT,
  );

  it(
    'reads travellers from the Traveller Free plan, so its AI limits come from plan data',
    async () => {
      const scope = await plansScope();
      const listed = await listPlansForAdmin(db, scope);
      if (!isOk(listed)) throw new Error('list');
      const traveller = listed.value.plans.find((p) => p.key === 'traveller_free');
      expect(traveller?.audience).toBe('TRAVELLER');
      expect(traveller?.rules['ai.ai_app_suggestions']).toEqual({ included: true, limit: 15 });
      const saved = await savePlan(db, scope, {
        planId: traveller?.id ?? '',
        draft: {
          name: 'Traveller Free',
          periodDays: traveller?.periodDays ?? 30,
          price: null,
          rules: { 'ai.ai_app_suggestions': { included: true, limit: 4 } },
        },
        stepUpSatisfied: true,
      });
      expect(isOk(saved)).toBe(true);
      const resolved = await resolveEntitlements(db, { accountId: ownerId });
      expect(resolved.features.ai_app_suggestions).toEqual({ included: true, dailyLimit: 4 });
      const ai = await aiEntitlementFor(db, { accountId: ownerId });
      expect(ai.features.ai_app_suggestions).toEqual({ included: true, dailyLimit: 4 });
    },
    TIMEOUT,
  );

  it(
    'charges a new price only from the next billing period; an invoice already made keeps its amount',
    async () => {
      const { organizationId } = await agency('price');
      const planId = await newPlan({ price: { priceMinorUnits: 100_000, currency: 'BDT' } });
      const opened = await openBillingAccount(db, {
        actor: actor(),
        stepUpSatisfied: true,
        organizationId,
        initialStatus: 'ACTIVE',
        reason: 'terms agreed',
      });
      if (!isOk(opened)) throw new Error('billing account');
      await db
        .update(schema.billingSettings)
        .set({ invoicingStartsAt: new Date(Date.now() - 400 * DAY) })
        .where(eq(schema.billingSettings.id, true));
      // On the plan since 10 days ago: the current period started then.
      const startedAt = new Date(Date.now() - 10 * DAY);
      await db
        .update(schema.subscriptions)
        .set({ endedAt: startedAt })
        .where(
          and(
            eq(schema.subscriptions.organizationId, organizationId),
            isNull(schema.subscriptions.endedAt),
          ),
        );
      await db.insert(schema.subscriptions).values({
        organizationId,
        planId,
        startedAt,
        assignedByAccountId: ownerId,
        reason: 'test',
      });
      const scope = systemScopeForTest('process-billing-cycle');
      await runBillingCycle(db, scope);
      const invoices = () =>
        db
          .select({
            amount: schema.invoices.invoicedAmountMinorUnits,
            start: schema.invoices.periodStart,
          })
          .from(schema.invoices)
          .where(eq(schema.invoices.organizationId, organizationId))
          .orderBy(asc(schema.invoices.periodStart));
      expect((await invoices()).map((i) => i.amount)).toEqual([100_000]);

      // The price changes now.
      const saved = await savePlan(db, await plansScope(), {
        planId,
        draft: draft({ price: { priceMinorUnits: 150_000, currency: 'BDT' } }),
        stepUpSatisfied: true,
      });
      expect(isOk(saved) && saved.value.priceChanged).toBe(true);
      const resolved = await resolveEntitlements(db, { organizationId });
      expect(resolved.plan?.price).toEqual({ priceMinorUnits: 100_000, currency: 'BDT' });
      expect(resolved.plan?.nextPrice?.priceMinorUnits).toBe(150_000);
      expect(resolved.plan?.nextPrice?.from.getTime()).toBe(startedAt.getTime() + 30 * DAY);

      // Later in the same period: nothing new, and the invoice already made is unchanged.
      await runBillingCycle(db, scope, { now: new Date(Date.now() + 5 * DAY) });
      expect((await invoices()).map((i) => i.amount)).toEqual([100_000]);
      // In the next period: the new price.
      await runBillingCycle(db, scope, { now: new Date(Date.now() + 25 * DAY) });
      expect((await invoices()).map((i) => i.amount)).toEqual([100_000, 150_000]);

      const audits = await db
        .select({ type: schema.auditEvents.eventType })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.resourceId, planId));
      expect(audits.map((a) => a.type)).toEqual(
        expect.arrayContaining(['PLAN_CREATED', 'PLAN_PRICE_CHANGED']),
      );
    },
    TIMEOUT,
  );

  it(
    'fixes the period once an agency has used the plan, and retires only plans that may be retired',
    async () => {
      const scope = await plansScope();
      const { organizationId } = await agency('retire');
      const planId = await newPlan();
      await putOn(organizationId, planId);
      const period = await savePlan(db, scope, {
        planId,
        draft: draft({ periodDays: 31 }),
        stepUpSatisfied: true,
      });
      expect(isErr(period) && period.error.reason).toBe('period_locked');
      expect(isErr(period) && period.error.field).toBe('periodDays');

      for (const key of ['traveller_free', 'agency_founding_access']) {
        const plan = await getPlanByKey(db, key);
        if (!plan) throw new Error(key);
        const refused = await retirePlan(db, scope, { planId: plan.id, stepUpSatisfied: true });
        expect(isErr(refused) && refused.error.reason).toBe('retire_blocked');
      }
      const retired = await retirePlan(db, scope, { planId, stepUpSatisfied: true });
      expect(isOk(retired) && retired.value.agenciesKeepingIt).toBe(1);
      // The agency keeps it; nobody new can be put on it.
      expect((await resolveEntitlements(db, { organizationId })).plan?.id).toBe(planId);
      const other = await agency('retire-2');
      const refused = await activateSubscription(db, {
        actor: actor(),
        stepUpSatisfied: true,
        organizationId: other.organizationId,
        planId,
        reason: 'test',
      });
      expect(isErr(refused)).toBe(true);
      // The traveller plan is never given to an agency.
      const travellerPlan = await getPlanByKey(db, 'traveller_free');
      const wrongAudience = await activateSubscription(db, {
        actor: actor(),
        stepUpSatisfied: true,
        organizationId: other.organizationId,
        planId: travellerPlan?.id ?? '',
        reason: 'test',
      });
      expect(isErr(wrongAudience)).toBe(true);
      const downgrade = await scheduleDowngrade(db, {
        actor: actor(),
        stepUpSatisfied: true,
        organizationId,
        toPlanId: travellerPlan?.id ?? '',
        reason: 'test',
      });
      expect(isErr(downgrade)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'needs the owner and a fresh sign-in check, and refuses bad drafts with the field at fault',
    async () => {
      const scope = await plansScope();
      const unchecked = await savePlan(db, scope, { draft: draft(), stepUpSatisfied: false });
      expect(isErr(unchecked) && unchecked.error.code).toBe('step_up_required');
      const badCurrency = await savePlan(db, scope, {
        draft: draft({ price: { priceMinorUnits: 1, currency: 'XYZ' } }),
        stepUpSatisfied: true,
      });
      expect(isErr(badCurrency) && badCurrency.error.field).toBe('currency');
      const badLimit = await savePlan(db, scope, {
        draft: draft({ rules: { seats: { included: false, limit: 3 } } }),
        stepUpSatisfied: true,
      });
      expect(isErr(badLimit) && badLimit.error.field).toBe('seats');
      const forged = await savePlan(db, {} as never, { draft: draft(), stepUpSatisfied: true });
      expect(isErr(forged) && forged.error.code).toBe('forbidden');
    },
    TIMEOUT,
  );
});
