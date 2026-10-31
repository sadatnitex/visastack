import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), aiUsage: vi.fn() }));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getTravellerPlanSummary: (...args: unknown[]) => mocks.summary(...args),
}));
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
  mocks.summary.mockResolvedValue({
    plan: { key: 'traveller_free', name: 'Traveller Free' },
    usedBytes: 12 * MB,
    profiles: [
      { applicantId: 'a1', displayName: 'Rahim Uddin', usedBytes: 10 * MB },
      { applicantId: 'a2', displayName: 'Ayesha Uddin', usedBytes: 2 * MB },
    ],
  });
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
    feature({
      feature: 'ai_consistency_checks',
      name: 'Consistency Checks',
      unit: 'checks',
      used: 0,
      available: false,
      reason: 'not_in_plan',
    }),
    feature({
      feature: 'ai_gap_explanations',
      name: 'Gap Explanations',
      unit: 'explanations',
      used: 0,
      available: false,
      reason: 'platform_off',
    }),
  ]);
});

describe('Plan & Usage for a traveller', () => {
  it('names the plan, says it is complimentary and that there is nothing to choose', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Plan & Usage');
    expect(text).toContain('Traveller Free');
    expect(text).toContain('Complimentary during public beta. No payment method is required.');
    expect(text).toContain('There are no paid plans for travellers');
    // Never a price, an upgrade or a payment step for a traveller.
    expect(text).not.toMatch(/Upgrade|BDT|Pay /);
    expect(mocks.summary).toHaveBeenCalledWith({}, { actorAccountId: 'acct-1' });
  });

  it('shows storage for the whole account and for each person, against the upload limits', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Your Whole Account 12 MB of 100 MB used');
    expect(text).toContain('Rahim Uddin 10 MB of 50 MB used');
    expect(text).toContain('Ayesha Uddin 2 MB of 50 MB used');
    expect(text).toContain('Each file can be up to 20 MB.');
  });

  it('says for each AI feature whether the plan includes it, its limit and today’s use', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Automatic Reading Included No daily limit. 2 files today.');
    expect(text).toContain(
      'AI App Suggestions Limit Reached Today Up to 15 a day. 15 of 15 suggestions today.',
    );
    expect(text).toContain('Consistency Checks Not in Your Plan 0 checks today.');
    expect(text).toContain('Gap Explanations Off for Now No daily limit. 0 explanations today.');
    expect(text).toContain('Daily limits start again at 6 AM Bangladesh time.');
  });

  it('leaves the AI card out when today’s use cannot be read, and keeps the rest', async () => {
    mocks.aiUsage.mockResolvedValue(null);
    const text = textOf(await renderServer(Page()));
    expect(text).not.toContain('AI Features');
    expect(text).toContain('Traveller Free');
    expect(text).toContain('Your Whole Account');
  });

  it('says nothing is stored yet for a new account', async () => {
    mocks.summary.mockResolvedValue({ plan: null, usedBytes: 0, profiles: [] });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Founding Access');
    expect(text).toContain('Nothing stored yet.');
  });

  it('passes the automated accessibility rules', async () => {
    expect(await axeViolations(await renderServer(Page()))).toEqual([]);
  });
});
