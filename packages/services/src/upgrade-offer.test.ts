import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selfPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { TRAVELLER_PLAN_KEY } from './entitlements';
import { DEFAULT_UPLOAD_QUOTAS } from './quotas';
import { type UpgradeShortfall, upgradeHelps, upgradeWouldHelp } from './upgrade-offer';

/**
 * ADR 0025 section 12.2: a paid plan is offered at the moment of need only while selling is on, a
 * plan is on sale, no paid period covers today, and a plan on sale really gives more of what ran
 * short. Traveller Free follows the upload settings for storage and allows 15 AI App Suggestions
 * a day (migration 0107); Reading with AI has no daily limit on it.
 */

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT = { kind: 'account_storage' } as const satisfies UpgradeShortfall;
const PERSON = { kind: 'person_storage' } as const satisfies UpgradeShortfall;
const AI = { kind: 'ai', feature: 'ai_app_suggestions' } as const satisfies UpgradeShortfall;
const ALL: readonly UpgradeShortfall[] = [ACCOUNT, PERSON, AI];

let db: Db;
let person: string;

beforeEach(async () => {
  vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  const made = await provisionAccount(db, { email: 'upgrade@example.com' });
  if (!isOk(made)) throw new Error('provision');
  person = made.value.id;
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Rules {
  readonly accountBytes?: number;
  readonly personBytes?: number;
  /** AI feature rules: a number is a daily limit, null no daily limit, false not included. */
  readonly ai?: Readonly<Record<string, number | null | false>>;
}

async function addRules(planId: string, rules: Rules): Promise<void> {
  const rows: (typeof schema.planEntitlements.$inferInsert)[] = [];
  if (rules.accountBytes !== undefined) {
    rows.push({
      planId,
      key: 'account_storage_bytes',
      included: true,
      limitValue: rules.accountBytes,
      per: 'TOTAL',
    });
  }
  if (rules.personBytes !== undefined) {
    rows.push({
      planId,
      key: 'person_storage_bytes',
      included: true,
      limitValue: rules.personBytes,
      per: 'TOTAL',
    });
  }
  for (const [feature, rule] of Object.entries(rules.ai ?? {})) {
    rows.push({
      planId,
      key: `ai.${feature}`,
      included: rule !== false,
      limitValue: rule === false ? null : rule,
      per: 'DAY',
    });
  }
  if (rows.length > 0) await db.insert(schema.planEntitlements).values(rows);
}

/** A paid traveller plan, on sale (priced in BDT) unless `price` is null. */
async function paidPlan(
  key: string,
  rules: Rules,
  price: { amount: number; currency: string } | null = { amount: 49_900, currency: 'BDT' },
): Promise<string> {
  const [plan] = await db
    .insert(schema.plans)
    .values({ key, name: key, audience: 'TRAVELLER', periodDays: 30 })
    .returning({ id: schema.plans.id });
  if (!plan) throw new Error('plan');
  if (price) {
    await db.insert(schema.planPrices).values({
      planId: plan.id,
      priceMinorUnits: price.amount,
      currency: price.currency,
      effectiveFrom: new Date('2001-01-01T00:00:00Z'),
    });
  }
  await addRules(plan.id, rules);
  return plan.id;
}

/** More of everything than Traveller Free and the upload settings give. */
const MORE: Rules = {
  accountBytes: 1000 * MB,
  personBytes: 500 * MB,
  ai: { ai_app_suggestions: 100 },
};

/** A paid, unrefunded period of `planId` for the person covering now. */
async function coveredNow(planId: string): Promise<void> {
  // Person payer columns are written with plain SQL until schema.ts declares them (ADR 0025).
  const sub = (
    (await db.execute(sql`
      insert into subscriptions (payer_account_id, plan_id, reason)
      values (${person}::uuid, ${planId}::uuid, 'Bought a paid plan')
      returning id`)) as unknown as { rows: { id: string }[] }
  ).rows[0];
  if (!sub) throw new Error('subscription');
  const start = new Date(Date.now() - 2 * DAY).toISOString();
  const end = new Date(Date.now() + 28 * DAY).toISOString();
  await db.execute(sql`
    insert into invoices (payer_account_id, subscription_id, plan_id, period_start, period_end,
      invoice_ref, invoiced_amount_minor_units, collected_amount_minor_units, currency, due_date, status)
    values (${person}::uuid, ${sub.id}::uuid, ${planId}::uuid, ${start}::timestamptz,
      ${end}::timestamptz, 'INV-P-UPGRADE-1', 49900, 49900, 'BDT', ${start}::timestamptz, 'PAID')`);
}

async function answers(): Promise<boolean[]> {
  return Promise.all(
    ALL.map((shortfall) => upgradeWouldHelp(db, selfPrincipal(person), shortfall)),
  );
}

describe('upgradeWouldHelp (ADR 0025 section 12.2)', () => {
  it('is true for each shortfall when a plan on sale gives more of it', async () => {
    await paidPlan('traveller_plus', MORE);
    expect(await answers()).toEqual([true, true, true]);
  });

  it('is false for every shortfall while selling is switched off', async () => {
    await paidPlan('traveller_plus', MORE);
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'false');
    expect(await answers()).toEqual([false, false, false]);
  });

  it('is false with no plan on sale: none at all, unpriced, not in BDT, or retired', async () => {
    expect(await answers()).toEqual([false, false, false]);
    await paidPlan('traveller_unpriced', MORE, null);
    await paidPlan('traveller_dollars', MORE, { amount: 1_000, currency: 'USD' });
    const retired = await paidPlan('traveller_retired', MORE);
    await db.update(schema.plans).set({ active: false }).where(eq(schema.plans.id, retired));
    expect(await answers()).toEqual([false, false, false]);
  });

  it('is false while a paid period covers today, even when another plan on sale gives more', async () => {
    const plus = await paidPlan('traveller_plus', {
      accountBytes: 200 * MB,
      personBytes: 100 * MB,
      ai: { ai_app_suggestions: 50 },
    });
    await paidPlan('traveller_max', MORE);
    expect(await answers()).toEqual([true, true, true]);
    await coveredNow(plus);
    expect(await answers()).toEqual([false, false, false]);
  });

  it('is false when no plan on sale gives more of what ran short', async () => {
    // The same room as the upload settings, and the same daily limit as Traveller Free.
    await paidPlan('traveller_same', {
      accountBytes: DEFAULT_UPLOAD_QUOTAS.maxAccountEvidenceBytes,
      personBytes: DEFAULT_UPLOAD_QUOTAS.maxApplicantEvidenceBytes,
      ai: { ai_app_suggestions: 15 },
    });
    // Less room, a lower limit, and a feature it leaves out.
    await paidPlan('traveller_less', {
      accountBytes: 10 * MB,
      personBytes: 5 * MB,
      ai: { ai_app_suggestions: 5, ai_app_original_files: false },
    });
    expect(await answers()).toEqual([false, false, false]);
    const self = selfPrincipal(person);
    expect(await upgradeWouldHelp(db, self, { kind: 'ai', feature: 'ai_app_original_files' })).toBe(
      false,
    );
    // Reading with AI has no daily limit on Traveller Free: a limit reached there is not the
    // plan's, so no plan lifts it, even one with no limit either.
    await paidPlan('traveller_unlimited', { ai: { ai_document_reading: null } });
    expect(await upgradeWouldHelp(db, self, { kind: 'ai', feature: 'ai_document_reading' })).toBe(
      false,
    );
  });

  it('is true for a feature a plan on sale includes with no daily limit', async () => {
    await paidPlan('traveller_unlimited', { ai: { ai_app_suggestions: null } });
    expect(await answers()).toEqual([false, false, true]);
  });

  it('counts the upload settings a plan follows when it sets no storage rule', async () => {
    // Traveller Free given its own, smaller room per person; the paid plan sets none, so it
    // follows the upload settings, which give more. Its account room follows them too: no more.
    const [free] = await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.key, TRAVELLER_PLAN_KEY));
    if (!free) throw new Error('Traveller Free');
    await addRules(free.id, { personBytes: 10 * MB });
    await paidPlan('traveller_follows', {});
    expect(await answers()).toEqual([false, true, false]);
  });

  it('refuses a forged scope: a copy of a genuine one says false', async () => {
    await paidPlan('traveller_plus', MORE);
    const forged = { ...selfPrincipal(person) } as unknown as ReturnType<typeof selfPrincipal>;
    for (const shortfall of ALL) {
      expect(await upgradeWouldHelp(db, forged, shortfall)).toBe(false);
    }
    expect(await upgradeWouldHelp(db, selfPrincipal(person), ACCOUNT)).toBe(true);
  });
});

describe('upgradeHelps (the decision Plan & Usage shares)', () => {
  const offer = {
    id: 'p1',
    key: 'traveller_plus',
    name: 'Traveller Plus',
    periodDays: 30,
    price: { amountMinorUnits: 49_900, currency: 'BDT' },
    features: {} as never,
    storage: { accountBytes: null, personBytes: null },
  };
  const base = {
    selling: true,
    offers: [{ ...offer, features: { ai_app_suggestions: { included: true, dailyLimit: 100 } } }],
    covered: false,
    storage: null,
    features: null,
    quota: DEFAULT_UPLOAD_QUOTAS,
  } as unknown as Parameters<typeof upgradeHelps>[0];

  it('uses the limit in force when the plan has no rule of its own, and nothing without one', () => {
    expect(upgradeHelps(base, { ...AI, limitNow: 15 })).toBe(true);
    expect(upgradeHelps(base, { ...AI, limitNow: 100 })).toBe(false);
    expect(upgradeHelps(base, AI)).toBe(false);
  });

  it('is false while selling is off or something paid covers today', () => {
    expect(upgradeHelps({ ...base, selling: false }, { ...AI, limitNow: 15 })).toBe(false);
    expect(upgradeHelps({ ...base, covered: true }, { ...AI, limitNow: 15 })).toBe(false);
    expect(upgradeHelps({ ...base, offers: [] }, { ...AI, limitNow: 15 })).toBe(false);
  });

  it("never promises more than the platform owner's own cap allows", () => {
    const planFive = {
      ...base,
      features: { ai_app_suggestions: { included: true, dailyLimit: 5 } },
    } as unknown as Parameters<typeof upgradeHelps>[0];
    // The owner capped it at 3: the plan's 5 and the paid plan's 100 both stop at 3.
    expect(upgradeHelps(planFive, { ...AI, adminCap: 3 })).toBe(false);
    // Plan & Usage passes the limit in force: below the plan's own, it is the owner's cap.
    expect(upgradeHelps(planFive, { ...AI, limitNow: 3 })).toBe(false);
    // A cap above the person's limit still leaves room a paid plan gives.
    expect(upgradeHelps(planFive, { ...AI, adminCap: 50 })).toBe(true);
    expect(upgradeHelps(planFive, AI)).toBe(true);
  });
});
