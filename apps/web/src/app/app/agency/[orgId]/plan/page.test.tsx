import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ usage: vi.fn() }));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@acme.example.com' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getUsageForOrganization: (...args: unknown[]) => mocks.usage(...args),
  getPendingDowngradeForOrganization: async () => undefined,
  listPlans: async () => [],
}));
vi.mock('../console-data', () => ({ loadOrgAccess: async () => ({ admin: true }) }));
vi.mock('../billing-status-notice', () => ({
  loadBillingNotice: async () => null,
  BillingStatusNotice: () => null,
}));

const { default: Page } = await import('./page');

const meter = (key: string, entitlement: string, label: string, allowed: number | null) => ({
  key,
  entitlement,
  label,
  definition: `${label} definition.`,
  used: 1,
  allowed,
  shownOnly: entitlement === 'ai_allowance_units',
});

function usage(entitlements: Record<string, unknown>) {
  return {
    ok: true,
    value: {
      planAssigned: true,
      plan: { name: 'Agency Growth', key: 'agency_growth', periodDays: 30 },
      meters: [
        meter('seats', 'seats', 'Team Members', 5),
        meter('invitations', 'invitations', 'Team Members and Invitations', 5),
        meter('aiAllowanceUnits', 'ai_allowance_units', 'AI Allowance', null),
      ],
      entitlements: {
        bypassLimits: false,
        plan: { price: { priceMinorUnits: 250000, currency: 'BDT' }, nextPrice: null },
        // Agencies have no AI features of their own yet: not applicable.
        features: null,
        ...entitlements,
      },
    },
  };
}

beforeEach(() => {
  navigationState.pathname = '/app/agency/o1/plan';
});

describe('Plan and Usage (S29)', () => {
  it('shows the price of this period, a coming price with its date, every limit and the AI features', async () => {
    mocks.usage.mockResolvedValue(
      usage({
        plan: {
          price: { priceMinorUnits: 250000, currency: 'BDT' },
          nextPrice: {
            priceMinorUnits: 300000,
            currency: 'BDT',
            from: new Date('2026-12-01T00:00:00Z'),
          },
        },
      }),
    );
    const text = textOf(await renderServer(Page({ params: Promise.resolve({ orgId: 'o1' }) })));
    expect(text).toContain('BDT 2,500.00');
    expect(text).toContain('the price is BDT 3,000.00');
    expect(text).toContain('Invoices already made keep their amounts.');
    expect(text).toContain('Team Members and Invitations');
    expect(text).toContain('it does not stop any work');
    // No AI feature list for an agency until agencies have AI features (round 2); S28 says so
    // plainly instead of leaving the section out.
    expect(text).not.toContain('AI App Suggestions');
    expect(text).not.toContain('Not in Your Plan');
    expect(text).toContain('AI features are not part of agency plans yet.');
  });

  it('says Complimentary from the plan flag, not from its key', async () => {
    mocks.usage.mockResolvedValue(usage({ bypassLimits: true }));
    const text = textOf(await renderServer(Page({ params: Promise.resolve({ orgId: 'o1' }) })));
    expect(text).toContain('Complimentary during public beta.');
    // Said once, not twice.
    expect(text.match(/Complimentary/g)).toHaveLength(1);
    expect(text).not.toContain('BDT 2,500.00');
  });
});
