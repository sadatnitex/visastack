import { JSDOM } from 'jsdom';
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
        // The traveller AI features are not applicable to an agency.
        features: null,
        // S22: the agency's own AI features, from its plan.
        agencyFeatures: { ai_agency_tools: { included: true, dailyLimit: 500 } },
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
    // The traveller AI features never show for an agency (round 2); since S22 the agency's own
    // AI feature does, counted for the whole agency.
    expect(text).not.toContain('AI App Suggestions');
    expect(text).not.toContain('Not in Your Plan');
    expect(text).toContain('Agency AI Tools');
    expect(text).toContain('Included, up to 500 a day for the whole agency');
  });

  it('says Complimentary from the plan flag, not from its key', async () => {
    mocks.usage.mockResolvedValue(usage({ bypassLimits: true }));
    const text = textOf(await renderServer(Page({ params: Promise.resolve({ orgId: 'o1' }) })));
    expect(text).toContain('Complimentary during public beta.');
    // Said once, not twice.
    expect(text.match(/Complimentary/g)).toHaveLength(1);
    expect(text).not.toContain('BDT 2,500.00');
  });

  const limitRows = (html: string) => [
    ...new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll('.u8-limit'),
  ];

  it('U8: one compact row per limit, a ring for a ceiling and the shared words, with no bar at all', async () => {
    mocks.usage.mockResolvedValue(usage({}));
    const html = await renderServer(Page({ params: Promise.resolve({ orgId: 'o1' }) }));
    const rows = limitRows(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('1 of 5 used');
    expect(rows[0]?.querySelector('.u8-ring-arc')).not.toBeNull();
    // No ceiling: the shared words, a plain disc and no arc.
    expect(rows[2]?.textContent).toContain('1 used (unlimited)');
    expect(rows[2]?.querySelector('.u8-ring-arc')).toBeNull();
    const doc = new JSDOM(`<body>${html}</body>`).window.document;
    expect(doc.querySelector('.meter, .meter-fill')).toBeNull();
  });

  it('U8: AI Features is one section whose rows sit inside it', async () => {
    mocks.usage.mockResolvedValue(usage({}));
    const doc = new JSDOM(
      `<body>${await renderServer(Page({ params: Promise.resolve({ orgId: 'o1' }) }))}</body>`,
    ).window.document;
    const titles = [...doc.querySelectorAll('.expandable-section-title')].filter(
      (h) => h.textContent === 'AI Features',
    );
    expect(titles).toHaveLength(1);
    expect(titles[0]?.closest('.expandable-section')?.textContent).toContain('Agency AI Tools');
  });

  it('U8: a limit of none in use draws a full ring, one with nothing allowed or used stays neutral, and an informational meter opens at first', async () => {
    const base = usage({});
    base.value.meters = [
      { ...meter('seats', 'seats', 'Team Members', 0), used: 2 },
      { ...meter('invitations', 'invitations', 'Invitations', 0), used: 0 },
      meter('aiAllowanceUnits', 'ai_allowance_units', 'AI Allowance', 5),
    ];
    mocks.usage.mockResolvedValue(base);
    const rows = limitRows(await renderServer(Page({ params: Promise.resolve({ orgId: 'o1' }) })));
    expect(rows[0]?.querySelector('.u8-ring-full .u8-ring-arc, .u8-ring-arc')).not.toBeNull();
    expect(rows[0]?.querySelector('.u8-ring')?.classList.contains('u8-ring-full')).toBe(true);
    expect(rows[1]?.querySelector('.u8-ring')?.classList.contains('u8-ring-full')).toBe(false);
    expect(rows[0]?.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(rows[2]?.querySelector('details')?.hasAttribute('open')).toBe(true);
  });
});
