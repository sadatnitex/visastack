import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  aiUsage: vi.fn(),
  applicants: vi.fn(),
  bytes: {} as Record<string, number>,
  catalogue: vi.fn(),
  purchase: vi.fn(),
  renewal: vi.fn(),
  billing: vi.fn(),
  count: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com', self: { kind: 'self' } }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getTravellerPlanSummary: (...args: unknown[]) => mocks.summary(...args),
  listApplicants: (...args: unknown[]) => mocks.applicants(...args),
  getApplicantEvidenceBytes: async (_db: unknown, id: string) => mocks.bytes[id] ?? 0,
  listTravellerPlansForSale: (...args: unknown[]) => mocks.catalogue(...args),
  getOwnPurchase: (...args: unknown[]) => mocks.purchase(...args),
  getOwnRenewal: (...args: unknown[]) => mocks.renewal(...args),
  hasOwnBilling: (...args: unknown[]) => mocks.billing(...args),
  countTravellerPlanEvent: (...args: unknown[]) => mocks.count(...args),
}));
vi.mock('./plan-forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return {
    BuyPlanForm: stub('BuyPlanForm'),
    PayPurchaseForm: stub('PayPurchaseForm'),
    RenewalForm: stub('RenewalForm'),
  };
});
vi.mock('../../../../lib/ai-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/ai-usage')>()),
  readAiUsage: (...args: unknown[]) => mocks.aiUsage(...args),
}));

const { default: Page } = await import('./page');

const MB = 1024 * 1024;

const feature = (overrides: Record<string, unknown>) => ({
  feature: 'ai_automatic_reading',
  name: 'Automatic Reading',
  unit: 'files',
  used: 2,
  dailyLimit: null,
  available: true,
  reason: null,
  ...overrides,
});

beforeEach(() => {
  navigationState.pathname = '/app/account/plan';
  mocks.count.mockReset();
  mocks.count.mockResolvedValue(undefined);
  mocks.renewal.mockResolvedValue(null);
  mocks.billing.mockResolvedValue(false);
  mocks.summary.mockResolvedValue({
    plan: { key: 'traveller_free', name: 'Traveller Free' },
    // The plan's own rules, apart from whether each feature works right now.
    features: {
      ai_automatic_reading: { included: true, dailyLimit: null },
      ai_app_suggestions: { included: true, dailyLimit: 15 },
      ai_consistency_checks: { included: false, dailyLimit: null },
      ai_explanations: { included: true, dailyLimit: null },
      ai_document_kind: { included: true, dailyLimit: 10 },
    },
    paidUntil: null,
    // Traveller Free sets no storage rules of its own: the upload settings apply.
    storage: { accountBytes: null, personBytes: null },
  });
  mocks.applicants.mockResolvedValue([
    { id: 'a1', displayName: 'Rahim Uddin' },
    { id: 'a2', displayName: 'Ayesha Uddin' },
  ]);
  mocks.bytes = { a1: 10 * MB, a2: 2 * MB };
  mocks.aiUsage.mockResolvedValue([
    feature({}),
    feature({
      feature: 'ai_app_suggestions',
      name: 'AI App Suggestions',
      unit: 'suggestions',
      used: 15,
      dailyLimit: 15,
      available: false,
      reason: 'daily_limit',
    }),
    // Left out by the plan while AI is also off for everyone: the plan decides what it says, and a
    // shared ceiling the feature carries is never shown as an allowance.
    feature({
      feature: 'ai_consistency_checks',
      name: 'Consistency Checks',
      unit: 'checks',
      used: 0,
      dailyLimit: 50,
      available: false,
      reason: 'platform_off',
    }),
    feature({
      feature: 'ai_explanations',
      name: 'Gap Explanations',
      unit: 'explanations',
      used: 0,
      available: false,
      reason: 'turned_off',
    }),
    // Not ready yet: its state carries no limit, so the plan's limit is shown.
    feature({
      feature: 'ai_document_kind',
      name: 'Document Kind Suggestions',
      unit: 'suggestions',
      used: 0,
      dailyLimit: null,
      available: false,
      reason: 'not_available_yet',
    }),
  ]);
});

describe('Plan & Usage for a traveller', () => {
  it('names the plan, says it is complimentary and that there is nothing to choose', async () => {
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Plan & Usage');
    expect(text).toContain('Traveller Free');
    expect(text).toContain('Complimentary during public beta. No payment method is required.');
    expect(text).toContain('Paid plans for travellers are not offered yet');
    // Never a price, an upgrade or a payment step for a traveller: the one sentence that says so
    // is the only place these words may appear.
    const rest = text.replace('so there is nothing to choose or upgrade', '');
    expect(rest).not.toMatch(/upgrade|\bbdt\b|\busd\b|\bpay\b|payment step|price/i);
    expect(mocks.summary).toHaveBeenCalledWith({}, { actorAccountId: 'acct-1' });
    // Storage reads only the signed-in account's own profiles.
    expect(mocks.applicants).toHaveBeenCalledWith({}, 'acct-1');
  });

  it('shows storage for the whole account and for each person, against the upload limits', async () => {
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Your Whole Account 12 MB of 100 MB used');
    expect(text).toContain('Rahim Uddin 10 MB of 50 MB used');
    expect(text).toContain('Ayesha Uddin 2 MB of 50 MB used');
    expect(text).toContain('Each file can be up to 20 MB.');
    expect(text).toContain("that agency's own plan can also limit what more can be added to it");
  });

  it('WP-SB9: shows a meter for the first 10 people, then Show More, still counting everyone', async () => {
    const people = Array.from({ length: 12 }, (_, index) => ({
      id: `person-${index}`,
      displayName: `Person ${String(index + 1).padStart(2, '0')}`,
    }));
    mocks.applicants.mockResolvedValue(people);
    for (const person of people) mocks.bytes[person.id] = MB;
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Person 10 1 MB of 50 MB used');
    expect(text).not.toContain('Person 11');
    // The account total still counts all 12 people.
    expect(text).toContain('Your Whole Account 12 MB of 100 MB used');
    expect(text).toContain('Showing 10 of 12 people.');
    expect(html).toContain('href="/app/account/plan?show=20#storage-row-10"');
    const all = textOf(await renderServer(Page({ searchParams: Promise.resolve({ show: '20' }) })));
    expect(all).toContain('Person 12 1 MB of 50 MB used');
    expect(all).toContain('Showing all 12 people.');
    for (const person of people) delete mocks.bytes[person.id];
  });

  it('measures storage against this account’s own limits, which its plan can raise', async () => {
    mocks.summary.mockResolvedValue({
      plan: { key: 'traveller_plus', name: 'Traveller Plus' },
      features: null,
      paidUntil: new Date('2026-12-12T06:00:00Z'),
      storage: { accountBytes: 500 * MB, personBytes: null },
    });
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Your Whole Account 12 MB of 500 MB used');
    // A rule the plan leaves open falls back to the upload setting.
    expect(text).toContain('Rahim Uddin 10 MB of 50 MB used');
    expect(text).toContain('Each person you keep a record for can hold up to 50 MB.');
  });

  it('says how long a paid plan is paid for, instead of the beta offer', async () => {
    mocks.summary.mockResolvedValue({
      plan: { key: 'traveller_plus', name: 'Traveller Plus' },
      features: null,
      paidUntil: new Date('2026-12-12T06:00:00Z'),
      storage: null,
    });
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Traveller Plus');
    expect(text).toMatch(/Paid until 12 Dec 2026/);
    expect(text).not.toContain('Complimentary during public beta');
    expect(text).not.toContain('not offered yet');
  });

  it('says for each AI feature whether the plan includes it, apart from whether it works now', async () => {
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Automatic Reading In Your Plan Now: On No daily limit. 2 files today.');
    expect(text).toContain(
      'AI App Suggestions In Your Plan Now: Limit Reached Up to 15 a day. 15 of 15 suggestions today.',
    );
    expect(text).toContain('Consistency Checks Not in Your Plan Gap Explanations');
    expect(text).not.toContain('of 50 checks');
    expect(text).toContain(
      'Gap Explanations In Your Plan Now: Off No daily limit. 0 explanations today. Gap Explanations is turned off right now.',
    );
    expect(text).toContain(
      'Document Kind Suggestions In Your Plan Now: Off Up to 10 a day. 0 of 10 suggestions today. Document Kind Suggestions is not available yet.',
    );
    expect(text).toContain('Daily limits start again at 6 AM Bangladesh time.');
  });

  it('falls back to the feature state when the plan has no rules to read', async () => {
    mocks.summary.mockResolvedValue({ plan: null, features: null, paidUntil: null, storage: null });
    mocks.applicants.mockResolvedValue([]);
    mocks.aiUsage.mockResolvedValue([
      feature({ name: 'Automatic Reading', available: false, reason: 'not_in_plan' }),
    ]);
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Automatic Reading Not in Your Plan');
  });

  it('leaves the AI card out when today’s use cannot be read, and keeps the rest', async () => {
    mocks.aiUsage.mockResolvedValue(null);
    const text = textOf(await renderServer(Page({})));
    expect(text).not.toContain('AI Features');
    expect(text).toContain('Traveller Free');
    expect(text).toContain('Your Whole Account');
  });

  it('says nothing is stored yet for a new account', async () => {
    mocks.summary.mockResolvedValue({ plan: null, features: null, paidUntil: null, storage: null });
    mocks.applicants.mockResolvedValue([]);
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Your Plan');
    expect(text).toContain('Nothing stored yet.');
  });

  it('links to Billing History once there is a purchase of theirs to show, and not before', async () => {
    expect(await renderServer(Page({}))).not.toContain('href="/app/account/plan/billing"');
    mocks.billing.mockResolvedValue(true);
    const html = await renderServer(Page({}));
    expect(html).toContain('href="/app/account/plan/billing"');
    expect(textOf(html)).toContain('Billing History');
    expect(mocks.billing.mock.calls[1]?.[1]).toEqual({ kind: 'self' });
  });

  it('passes the automated accessibility rules', async () => {
    expect(await axeViolations(await renderServer(Page({})))).toEqual([]);
  });
});

describe('buying a paid plan on Plan & Usage (ADR 0025 T3c)', () => {
  const plus = {
    id: '00000000-0000-4000-8000-0000000000aa',
    key: 'traveller_plus',
    name: 'Traveller Plus',
    periodDays: 30,
    price: { amountMinorUnits: 49900, currency: 'BDT' },
    features: {
      ai_automatic_reading: { included: true, dailyLimit: null },
      ai_app_suggestions: { included: true, dailyLimit: 60 },
    },
    storage: { accountBytes: 500 * MB, personBytes: null },
  };
  const catalogue = {
    free: {
      name: 'Traveller Free',
      features: {
        ai_automatic_reading: { included: true, dailyLimit: null },
        ai_app_suggestions: { included: true, dailyLimit: 15 },
      },
      storage: { accountBytes: null, personBytes: null },
    },
    offers: [plus],
  };

  beforeEach(() => {
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
    mocks.catalogue.mockResolvedValue(catalogue);
    mocks.purchase.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('compares Traveller Free with the paid plans in a real table, with a Get button per plan', async () => {
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Compare Plans');
    expect(text).toContain('Everything in VisaStack stays free during the beta.');
    expect(text).toContain('Price Free BDT 499.00 for 30 days');
    expect(text).toContain('Storage for the Whole Account 100 MB 500 MB');
    expect(text).toContain('Storage per Person 50 MB 50 MB');
    expect(text).toContain('AI App Suggestions Up to 15 a day Up to 60 a day');
    expect(text).toContain('You can compare it with the paid plans below.');
    expect(text).not.toContain('not offered yet');
    expect(html).toContain('<th scope="col">Traveller Plus</th>');
    expect(html).toContain('data-label="Traveller Plus"');
    expect(stubProps<{ planId: string }>(html, 'BuyPlanForm').map((p) => p.planId)).toEqual([
      plus.id,
    ]);
  });

  it('points to the plans once, only where a plan on sale gives more of what ran short', async () => {
    // The whole account is 85% used and Plus gives the account 500 MB: the storage line shows.
    mocks.bytes = { a1: 45 * MB, a2: 40 * MB };
    const tight = textOf(await renderServer(Page({})));
    expect(tight).toContain(
      'Running out of room? A paid plan gives you more storage. Compare Plans',
    );
    // App Suggestions is at its limit of 15 and Plus allows 60 a day.
    expect(tight).toContain(
      'Reached a daily limit? A paid plan gives you higher daily limits. Compare Plans',
    );
    // One person is 90% used, but Plus keeps the same per-person limit: no promise of more room.
    mocks.bytes = { a1: 45 * MB, a2: 2 * MB };
    const personOnly = textOf(await renderServer(Page({})));
    expect(personOnly).not.toContain('Running out of room?');
    // A plan whose limit for the feature that ran out is no higher: no AI line.
    mocks.catalogue.mockResolvedValue({
      ...catalogue,
      offers: [
        {
          ...plus,
          features: { ...plus.features, ai_app_suggestions: { included: true, dailyLimit: 15 } },
        },
      ],
    });
    expect(textOf(await renderServer(Page({})))).not.toContain('Reached a daily limit?');
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'false');
    expect(textOf(await renderServer(Page({})))).not.toContain('Compare Plans');
  });

  it('offers nothing to buy while a paid period covers today', async () => {
    mocks.summary.mockResolvedValue({
      plan: { key: 'traveller_plus', name: 'Traveller Plus' },
      features: null,
      paidUntil: new Date('2026-12-12T06:00:00Z'),
      storage: null,
    });
    const html = await renderServer(Page({}));
    expect(textOf(html)).toContain('Your paid plan covers today.');
    expect(stubProps(html, 'BuyPlanForm')).toHaveLength(0);
  });

  it('shows the purchase to confirm before the payment page, with no automatic charge', async () => {
    mocks.purchase.mockResolvedValue({
      invoiceId: '00000000-0000-4000-8000-0000000000bb',
      invoiceRef: 'TP-ABCDEF12-1',
      planName: 'Traveller Plus',
      amountMinorUnits: 49900,
      currency: 'BDT',
      periodStart: new Date('2026-11-01T10:00:00Z'),
      // Midnight in Dhaka on 1 Dec: the last covered day is 30 Nov.
      periodEnd: new Date('2026-11-30T18:00:00Z'),
    });
    const html = await renderServer(
      Page({ searchParams: Promise.resolve({ purchase: '00000000-0000-4000-8000-0000000000bb' }) }),
    );
    const text = textOf(html);
    expect(text).toContain('Confirm Your Purchase');
    expect(text).toContain('Plan Traveller Plus Price BDT 499.00');
    expect(text).toContain('Reference TP-ABCDEF12-1');
    expect(text).toMatch(/Covers You From 1 Nov 2026/);
    expect(text).toMatch(/Covers You Until 30 Nov 2026/);
    expect(html).toContain('id="confirm-purchase-title"');
    expect(text).toContain('No automatic charge.');
    expect(mocks.purchase.mock.calls[0]?.[2]).toEqual({
      invoiceId: '00000000-0000-4000-8000-0000000000bb',
    });
    expect(stubProps<{ invoiceId: string }>(html, 'PayPurchaseForm')[0]?.invoiceId).toBe(
      '00000000-0000-4000-8000-0000000000bb',
    );
  });

  it('says a purchase can no longer be paid, and never reads one for an address that is not an id', async () => {
    const gone = textOf(
      await renderServer(
        Page({
          searchParams: Promise.resolve({ purchase: '00000000-0000-4000-8000-0000000000cc' }),
        }),
      ),
    );
    expect(gone).toContain('This purchase can no longer be paid.');
    expect(gone).toContain('You can start it again below.');
    mocks.purchase.mockClear();
    await renderServer(Page({ searchParams: Promise.resolve({ purchase: 'not-an-id' }) }));
    expect(mocks.purchase).not.toHaveBeenCalled();
  });

  it('counts one Plan & Usage view while selling is on, a number and never who (T6)', async () => {
    await renderServer(Page({}));
    expect(mocks.count).toHaveBeenCalledTimes(1);
    expect(mocks.count.mock.calls[0]).toEqual([{}, 'PLAN_VIEWED']);
    // Started beside the page's own reads, not after them: it is already counting by the time
    // the plan summary comes back.
    mocks.count.mockClear();
    const summary: unknown = await mocks.summary();
    let countingAlready = false;
    mocks.summary.mockImplementationOnce(() =>
      Promise.resolve().then(() => {
        countingAlready = mocks.count.mock.calls.length > 0;
        return summary;
      }),
    );
    await renderServer(Page({}));
    expect(countingAlready).toBe(true);
  });

  it('shows nothing to buy, and reads no plans, while selling is switched off', async () => {
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'false');
    mocks.catalogue.mockClear();
    mocks.purchase.mockClear();
    const html = await renderServer(
      Page({ searchParams: Promise.resolve({ purchase: '00000000-0000-4000-8000-0000000000bb' }) }),
    );
    const text = textOf(html);
    expect(text).not.toContain('Compare Plans');
    expect(text).not.toContain('Confirm Your Purchase');
    expect(text).toContain('Paid plans for travellers are not offered yet');
    expect(mocks.catalogue).not.toHaveBeenCalled();
    expect(mocks.purchase).not.toHaveBeenCalled();
    // Nothing is counted while nothing is sold.
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('passes the automated accessibility rules with the comparison and the confirmation', async () => {
    mocks.purchase.mockResolvedValue({
      invoiceId: '00000000-0000-4000-8000-0000000000bb',
      invoiceRef: 'TP-ABCDEF12-1',
      planName: 'Traveller Plus',
      amountMinorUnits: 49900,
      currency: 'BDT',
      periodStart: new Date('2026-11-01T10:00:00Z'),
      periodEnd: new Date('2026-12-01T00:00:00Z'),
    });
    expect(
      await axeViolations(
        await renderServer(
          Page({
            searchParams: Promise.resolve({ purchase: '00000000-0000-4000-8000-0000000000bb' }),
          }),
        ),
      ),
    ).toEqual([]);
  });
});

describe('renewing a paid plan on Plan & Usage (ADR 0025 T4)', () => {
  const RENEWAL = '00000000-0000-4000-8000-0000000000cc';
  const DAY = 24 * 60 * 60 * 1000;
  const covered = (paidUntil: Date | null) =>
    mocks.summary.mockResolvedValue({
      plan:
        paidUntil === null
          ? { key: 'traveller_free', name: 'Traveller Free' }
          : { key: 'traveller_plus', name: 'Traveller Plus' },
      features: null,
      paidUntil,
      storage: null,
    });
  const renewal = (overrides: Record<string, unknown>) => {
    const paidUntil = new Date(Date.now() + 5 * DAY);
    return {
      planName: 'Traveller Plus',
      renews: true,
      renewable: true,
      paidUntil,
      payableUntil: new Date(paidUntil.getTime() + 7 * DAY),
      openRenewal: { invoiceId: RENEWAL, amountMinorUnits: 49900, currency: 'BDT' },
      ...overrides,
    };
  };

  beforeEach(() => {
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
    mocks.catalogue.mockResolvedValue({
      free: {
        name: 'Traveller Free',
        features: {},
        storage: { accountBytes: null, personBytes: null },
      },
      offers: [
        {
          id: '00000000-0000-4000-8000-0000000000aa',
          key: 'traveller_plus',
          name: 'Traveller Plus',
          periodDays: 30,
          price: { amountMinorUnits: 49900, currency: 'BDT' },
          features: { ai_app_suggestions: { included: true, dailyLimit: 60 } },
          storage: { accountBytes: 500 * MB, personBytes: null },
        },
      ],
    });
    mocks.purchase.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('offers Renew Now for the waiting renewal and Stop Renewing, with the price and no automatic charge', async () => {
    const view = renewal({});
    covered(view.paidUntil);
    mocks.renewal.mockResolvedValue(view);
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Your renewal is ready');
    expect(text).toContain('for the next period');
    expect(html).toContain(`href="/app/account/plan?purchase=${RENEWAL}#confirm-purchase-title"`);
    expect(text).toContain('Renew Now');
    expect(stubProps(html, 'RenewalForm')).toEqual([{ renews: true }]);
    expect(mocks.renewal.mock.calls[0]?.[1]).toEqual({ kind: 'self' });
  });

  it('says when the reminder comes before a renewal is made, and nothing is charged', async () => {
    const view = renewal({ openRenewal: null });
    covered(view.paidUntil);
    mocks.renewal.mockResolvedValue(view);
    const html = await renderServer(Page({}));
    expect(textOf(html)).toContain('We remind you 7 days before Traveller Plus ends');
    expect(textOf(html)).not.toContain('Renew Now');
  });

  it('after Stop Renewing, says when the plan ends and offers Keep Renewing only', async () => {
    const view = renewal({ renews: false });
    covered(view.paidUntil);
    mocks.renewal.mockResolvedValue(view);
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Renewing is off, so Traveller Plus ends after');
    expect(text).not.toContain('Renew Now');
    expect(stubProps(html, 'RenewalForm')).toEqual([{ renews: false }]);
  });

  it('inside the grace week, points to renewing instead of buying again', async () => {
    const paidUntil = new Date(Date.now() - 2 * DAY);
    covered(null);
    mocks.renewal.mockResolvedValue(
      renewal({ paidUntil, payableUntil: new Date(paidUntil.getTime() + 7 * DAY) }),
    );
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('You can still renew it until');
    expect(text).toContain('You can still renew Traveller Plus above and keep it.');
    expect(text).toContain('Renew Now');
    expect(stubProps(html, 'BuyPlanForm')).toHaveLength(0);
  });

  it('says a plan no longer offered simply ends, with no renewal controls', async () => {
    const view = renewal({ renewable: false, openRenewal: null });
    covered(view.paidUntil);
    mocks.renewal.mockResolvedValue(view);
    const html = await renderServer(Page({}));
    expect(textOf(html)).toContain('Traveller Plus is no longer offered, so it ends after');
    expect(stubProps(html, 'RenewalForm')).toHaveLength(0);
    expect(textOf(html)).not.toContain('Renew Now');
  });

  it('reads no renewal while selling is switched off', async () => {
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'false');
    mocks.renewal.mockClear();
    const html = await renderServer(Page({}));
    expect(mocks.renewal).not.toHaveBeenCalled();
    expect(stubProps(html, 'RenewalForm')).toHaveLength(0);
  });

  it('passes the automated accessibility rules with the renewal controls', async () => {
    const view = renewal({});
    covered(view.paidUntil);
    mocks.renewal.mockResolvedValue(view);
    expect(await axeViolations(await renderServer(Page({})))).toEqual([]);
  });
});
