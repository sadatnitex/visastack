import { isErr, isOk } from '@visastack/core';
import { AI_PLAN_TIERS, AI_TRAVELLER_FEATURE_KEYS } from '@visastack/core/ai-features';
import { type EntitlementKey, aiEntitlementKey } from '@visastack/core/entitlements';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { TRAVELLER_PLAN_KEY } from './entitlements';
import {
  type PlanDraft,
  listPlansForAdmin,
  previewPlanRetire,
  retirePlan,
  savePlan,
} from './plans-admin';
import { grantPlatformRole } from './platform-roles';
import { BYTES_PER_MB, DEFAULT_UPLOAD_QUOTAS } from './quotas';

/**
 * ADR 0025, T2b: the owner creates priced traveller plans on the Plans page. A traveller plan is
 * sold in BDT or not at all, carries storage and AI rules only, and never gives less than Traveller
 * Free; Traveller Free stays unpriced, follows the upload settings for storage and is never retired.
 */

const OWNER_EMAIL = 'owner-traveller-plans@platform.example.com';
const MB = BYTES_PER_MB;

// A traveller AI feature Traveller Free includes with a daily limit, read from the registry.
const LIMITED = AI_TRAVELLER_FEATURE_KEYS.find(
  (f) => AI_PLAN_TIERS.FREE[f].included && AI_PLAN_TIERS.FREE[f].dailyLimit !== null,
);
if (!LIMITED) throw new Error('expected a traveller AI feature with a daily limit on Free');
const LIMITED_KEY = aiEntitlementKey(LIMITED);
const FREE_LIMIT = AI_PLAN_TIERS.FREE[LIMITED].dailyLimit as number;

let db: Db;
let ownerId: string;

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  ownerId = await account(OWNER_EMAIL);
  const granted = await grantPlatformRole(db, {
    actor: { accountId: ownerId, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
    targetAccountId: ownerId,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
}, 60_000);

async function scope() {
  const minted = await staffPrincipal(
    db,
    { accountId: ownerId, email: OWNER_EMAIL, bootstrapEmails: [] },
    'PLANS_MANAGE',
  );
  if (!isOk(minted)) throw new Error('scope');
  return minted.value;
}

const plus = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  name: 'Traveller Plus',
  periodDays: 30,
  price: { priceMinorUnits: 49_900, currency: 'BDT' },
  rules: {
    account_storage_bytes: { included: true, limit: 500 * MB },
    person_storage_bytes: { included: true, limit: 200 * MB },
    [LIMITED_KEY]: { included: true, limit: FREE_LIMIT * 4 },
  },
  ...overrides,
});

async function createPlus(overrides: Partial<PlanDraft> = {}) {
  return savePlan(db, await scope(), {
    audience: 'TRAVELLER',
    draft: plus(overrides),
    stepUpSatisfied: true,
  });
}

async function freePlanId(): Promise<string> {
  const [row] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.key, TRAVELLER_PLAN_KEY));
  if (!row) throw new Error('Traveller Free missing');
  return row.id;
}

async function rulesOf(planId: string): Promise<Partial<Record<EntitlementKey, number | null>>> {
  const rows = await db
    .select({ key: schema.planEntitlements.key, limit: schema.planEntitlements.limitValue })
    .from(schema.planEntitlements)
    .where(eq(schema.planEntitlements.planId, planId));
  return Object.fromEntries(rows.map((r) => [r.key, r.limit]));
}

describe('creating a priced traveller plan (ADR 0025 T2b)', () => {
  it('saves a traveller plan with its price, storage and AI rules, and no agency limits', async () => {
    const saved = await createPlus();
    if (!isOk(saved)) throw new Error(saved.error.message);
    const [plan] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, saved.value.planId));
    expect(plan?.audience).toBe('TRAVELLER');
    expect(plan?.key).toMatch(/^traveller_traveller_plus_[0-9a-f]{6}$/);
    expect(plan?.bypassLimits).toBe(false);
    expect(plan?.priceMinorUnits).toBe(49_900);
    expect(plan?.currency).toBe('BDT');

    const rules = await rulesOf(saved.value.planId);
    expect(rules.account_storage_bytes).toBe(500 * MB);
    expect(rules.person_storage_bytes).toBe(200 * MB);
    expect(rules[LIMITED_KEY]).toBe(FREE_LIMIT * 4);
    for (const agencyKey of ['seats', 'invitations', 'cases_per_period', 'storage_bytes']) {
      expect(rules, agencyKey).not.toHaveProperty(agencyKey);
    }

    const [audit] = await db
      .select({ metadata: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.eventType, 'PLAN_CREATED'),
          eq(schema.auditEvents.resourceId, saved.value.planId),
        ),
      );
    expect((audit?.metadata as { after: { audience: string } }).after.audience).toBe('TRAVELLER');

    const listed = await listPlansForAdmin(db, await scope());
    if (!isOk(listed)) throw new Error('list');
    const view = listed.value.plans.find((p) => p.id === saved.value.planId);
    expect(view?.onIt).toBe(0);
    expect(view?.retireBlocked).toBeNull();
    expect(view?.rules.person_storage_bytes).toEqual({ included: true, limit: 200 * MB });
    expect(view?.rules).not.toHaveProperty('seats');
  });

  it('may be saved without a price, which means it is not sold', async () => {
    const saved = await createPlus({ price: null });
    expect(isOk(saved)).toBe(true);
  });

  it('refuses another currency, a price of 0, agency limits, and storage that is off or 0', async () => {
    const refusals: [Partial<PlanDraft>, string, RegExp][] = [
      [{ price: { priceMinorUnits: 500, currency: 'USD' } }, 'currency', /BDT only/],
      [{ price: { priceMinorUnits: 0, currency: 'BDT' } }, 'price', /same as Traveller Free/],
      [
        { rules: { ...plus().rules, seats: { included: true, limit: 3 } } },
        '',
        /rule VisaStack does not know/,
      ],
      [
        { rules: { ...plus().rules, person_storage_bytes: { included: false, limit: null } } },
        'person_storage_bytes',
        /cannot be switched off/,
      ],
      [
        { rules: { ...plus().rules, account_storage_bytes: { included: true, limit: 0 } } },
        'account_storage_bytes',
        /1 or more/,
      ],
    ];
    for (const [overrides, field, message] of refusals) {
      const saved = await createPlus(overrides);
      expect(isErr(saved) && saved.error.message, field).toMatch(message);
      if (field && isErr(saved)) expect(saved.error.field).toBe(field);
    }
    const plans = await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.audience, 'TRAVELLER'));
    expect(plans).toHaveLength(1);
  });

  it('refuses traveller storage rules on an agency plan', async () => {
    const saved = await savePlan(db, await scope(), {
      draft: {
        name: 'Agency Odd',
        periodDays: 30,
        price: null,
        rules: { person_storage_bytes: { included: true, limit: 100 * MB } },
      },
      stepUpSatisfied: true,
    });
    expect(isErr(saved) && saved.error.message).toMatch(/rule VisaStack does not know/);
  });
});

describe('a paid traveller plan never gives less than Traveller Free (ADR 0025 D1)', () => {
  it('refuses less storage than the upload settings Traveller Free follows', async () => {
    const below = DEFAULT_UPLOAD_QUOTAS.maxApplicantEvidenceBytes - MB;
    const saved = await createPlus({
      rules: { ...plus().rules, person_storage_bytes: { included: true, limit: below } },
    });
    expect(isErr(saved) && saved.error.message).toMatch(
      /must give at least what Traveller Free gives\. Storage per Person is 50 MB on Traveller Free\./,
    );
    expect(isErr(saved) && saved.error.field).toBe('person_storage_bytes');
    // Empty follows the same settings, so it is exactly as much as Free: allowed.
    const same = await createPlus({
      rules: { ...plus().rules, person_storage_bytes: { included: true, limit: null } },
    });
    expect(isOk(same)).toBe(true);
  });

  it('refuses an AI feature that is off, or a lower daily limit, than on Traveller Free', async () => {
    const off = await createPlus({
      rules: { ...plus().rules, [LIMITED_KEY]: { included: false, limit: null } },
    });
    expect(isErr(off) && off.error.message).toMatch(/is on in Traveller Free/);
    const lower = await createPlus({
      rules: { ...plus().rules, [LIMITED_KEY]: { included: true, limit: FREE_LIMIT - 1 } },
    });
    expect(isErr(lower) && lower.error.message).toMatch(
      new RegExp(`up to ${FREE_LIMIT} a day on Traveller Free`),
    );
    expect(isErr(lower) && lower.error.field).toBe(LIMITED_KEY);
  });

  it('refuses a change to an existing paid plan that would put it below Free', async () => {
    const saved = await createPlus();
    if (!isOk(saved)) throw new Error(saved.error.message);
    const changed = await savePlan(db, await scope(), {
      planId: saved.value.planId,
      draft: {
        ...plus(),
        rules: { [LIMITED_KEY]: { included: true, limit: FREE_LIMIT - 1 } },
      },
      stepUpSatisfied: true,
    });
    expect(isErr(changed) && changed.error.message).toMatch(/must give at least/);
    expect((await rulesOf(saved.value.planId))[LIMITED_KEY]).toBe(FREE_LIMIT * 4);
  });

  it('refuses raising Traveller Free above an offered paid plan, but not above a retired one', async () => {
    const saved = await createPlus();
    if (!isOk(saved)) throw new Error(saved.error.message);
    const free = await freePlanId();
    const raise = (limit: number) =>
      scope().then((staff) =>
        savePlan(db, staff, {
          planId: free,
          draft: {
            name: 'Traveller Free',
            periodDays: 30,
            price: null,
            rules: { [LIMITED_KEY]: { included: true, limit } },
          },
          stepUpSatisfied: true,
        }),
      );
    const above = await raise(FREE_LIMIT * 4 + 1);
    expect(isErr(above) && above.error.message).toMatch(
      /Traveller Plus would then give less than Traveller Free\..*Raise Traveller Plus first\./,
    );
    const retired = await retirePlan(db, await scope(), {
      planId: saved.value.planId,
      stepUpSatisfied: true,
    });
    expect(isOk(retired)).toBe(true);
    expect(isOk(await raise(FREE_LIMIT * 4 + 1))).toBe(true);
  });
});

describe('Traveller Free on the Plans page (ADR 0025 D10)', () => {
  it('keeps no price, follows the upload settings for storage, and is never retired', async () => {
    const free = await freePlanId();
    const base = { name: 'Traveller Free', periodDays: 30 };
    const priced = await savePlan(db, await scope(), {
      planId: free,
      draft: { ...base, price: { priceMinorUnits: 100, currency: 'BDT' }, rules: {} },
      stepUpSatisfied: true,
    });
    expect(isErr(priced) && priced.error.message).toBe('The traveller plan has no price.');
    const storage = await savePlan(db, await scope(), {
      planId: free,
      draft: {
        ...base,
        price: null,
        rules: { account_storage_bytes: { included: true, limit: 900 * MB } },
      },
      stepUpSatisfied: true,
    });
    expect(isErr(storage) && storage.error.message).toMatch(/follows the upload settings/);
    expect(await rulesOf(free)).not.toHaveProperty('account_storage_bytes');
    const retired = await retirePlan(db, await scope(), { planId: free, stepUpSatisfied: true });
    expect(isErr(retired) && retired.error.message).toMatch(/cannot be retired/);
  });

  it('counts every account except the people on a paid traveller plan', async () => {
    const saved = await createPlus();
    if (!isOk(saved)) throw new Error(saved.error.message);
    const buyer = await account('buyer@example.com');
    await account('free@example.com');
    // A person's own subscription, written as T3's checkout will (plain SQL until T3, ADR 0025).
    await db.execute(sql`
      insert into subscriptions (payer_account_id, plan_id, reason)
      values (${buyer}::uuid, ${saved.value.planId}::uuid, 'Bought Traveller Plus')`);
    const listed = await listPlansForAdmin(db, await scope());
    if (!isOk(listed)) throw new Error('list');
    const accounts = (await db.select({ id: schema.accounts.id }).from(schema.accounts)).length;
    const freeView = listed.value.plans.find((p) => p.key === TRAVELLER_PLAN_KEY);
    const plusView = listed.value.plans.find((p) => p.id === saved.value.planId);
    expect(plusView?.onIt).toBe(1);
    expect(freeView?.onIt).toBe(accounts - 1);
    // Someone has been on it: its period is fixed, and retiring keeps the person on it.
    expect(plusView?.periodLocked).toBe(true);
    const preview = await previewPlanRetire(db, await scope(), saved.value.planId);
    expect(isOk(preview) && preview.value.agenciesOnIt).toBe(1);
    const period = await savePlan(db, await scope(), {
      planId: saved.value.planId,
      draft: { ...plus(), periodDays: 90 },
      stepUpSatisfied: true,
    });
    expect(isErr(period) && period.error.message).toMatch(
      /period cannot change once someone has been on this plan/,
    );
  });
});
