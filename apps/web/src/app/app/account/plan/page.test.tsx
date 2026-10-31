import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  aiUsage: vi.fn(),
  applicants: vi.fn(),
  bytes: {} as Record<string, number>,
  limits: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getTravellerPlanSummary: (...args: unknown[]) => mocks.summary(...args),
  listApplicants: (...args: unknown[]) => mocks.applicants(...args),
  getApplicantEvidenceBytes: async (_db: unknown, id: string) => mocks.bytes[id] ?? 0,
  storageLimitsForOwner: (...args: unknown[]) => mocks.limits(...args),
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
    // The plan's own rules, apart from whether each feature works right now.
    features: {
      ai_automatic_reading: { included: true, dailyLimit: null },
      ai_app_suggestions: { included: true, dailyLimit: 15 },
      ai_consistency_checks: { included: false, dailyLimit: null },
      ai_explanations: { included: true, dailyLimit: null },
      ai_document_kind: { included: true, dailyLimit: 10 },
    },
  });
  mocks.applicants.mockResolvedValue([
    { id: 'a1', displayName: 'Rahim Uddin' },
    { id: 'a2', displayName: 'Ayesha Uddin' },
  ]);
  mocks.bytes = { a1: 10 * MB, a2: 2 * MB };
  mocks.limits.mockResolvedValue({ accountBytes: 100 * MB, personBytes: 50 * MB });
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
    const text = textOf(await renderServer(Page()));
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
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Your Whole Account 12 MB of 100 MB used');
    expect(text).toContain('Rahim Uddin 10 MB of 50 MB used');
    expect(text).toContain('Ayesha Uddin 2 MB of 50 MB used');
    expect(text).toContain('Each file can be up to 20 MB.');
    expect(text).toContain("that agency's own plan can also limit what more can be added to it");
  });

  it('measures storage against this account’s own limits, which its plan can raise', async () => {
    mocks.limits.mockResolvedValue({ accountBytes: 500 * MB, personBytes: 200 * MB });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Your Whole Account 12 MB of 500 MB used');
    expect(text).toContain('Rahim Uddin 10 MB of 200 MB used');
    expect(text).toContain('Each person you keep a record for can hold up to 200 MB.');
    expect(mocks.limits.mock.calls[0]?.[1]).toBe('acct-1');
  });

  it('says how long a paid plan is paid for, instead of the beta offer', async () => {
    mocks.summary.mockResolvedValue({
      plan: { key: 'traveller_plus', name: 'Traveller Plus' },
      features: null,
      paidUntil: new Date('2026-12-12T06:00:00Z'),
    });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Traveller Plus');
    expect(text).toMatch(/Paid until 12 Dec 2026/);
    expect(text).not.toContain('Complimentary during public beta');
    expect(text).not.toContain('not offered yet');
  });

  it('says for each AI feature whether the plan includes it, apart from whether it works now', async () => {
    const text = textOf(await renderServer(Page()));
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
    mocks.summary.mockResolvedValue({ plan: null, features: null });
    mocks.applicants.mockResolvedValue([]);
    mocks.aiUsage.mockResolvedValue([
      feature({ name: 'Automatic Reading', available: false, reason: 'not_in_plan' }),
    ]);
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Automatic Reading Not in Your Plan');
  });

  it('leaves the AI card out when today’s use cannot be read, and keeps the rest', async () => {
    mocks.aiUsage.mockResolvedValue(null);
    const text = textOf(await renderServer(Page()));
    expect(text).not.toContain('AI Features');
    expect(text).toContain('Traveller Free');
    expect(text).toContain('Your Whole Account');
  });

  it('says nothing is stored yet for a new account', async () => {
    mocks.summary.mockResolvedValue({ plan: null, features: null });
    mocks.applicants.mockResolvedValue([]);
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Your Plan');
    expect(text).toContain('Nothing stored yet.');
  });

  it('passes the automated accessibility rules', async () => {
    expect(await axeViolations(await renderServer(Page()))).toEqual([]);
  });
});
