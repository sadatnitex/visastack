import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ staffPrincipal: vi.fn(), listPlansForAdmin: vi.fn() }));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listPlansForAdmin: (...args: unknown[]) => mocks.listPlansForAdmin(...args),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('./forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { PlanForm: stub('PlanForm'), RetirePlanForm: stub('RetirePlanForm') };
});

const { default: Page } = await import('./page');

const rules = (limit: number | null) => ({
  seats: { included: true, limit },
  invitations: { included: true, limit },
  cases_per_period: { included: true, limit: null },
  open_cases: { included: true, limit: null },
  storage_bytes: { included: true, limit: 1024 * 1024 * 1024 },
  ai_allowance_units: { included: true, limit: null },
  'ai.ai_app_suggestions': { included: true, limit: 15 },
  'ai.ai_app_original_files': { included: false, limit: null },
});

const plan = (overrides: Record<string, unknown>) => ({
  id: '00000000-0000-4000-8000-000000000001',
  key: 'agency_growth_abc123',
  name: 'Agency Growth',
  audience: 'AGENCY',
  active: true,
  bypassLimits: false,
  periodDays: 30,
  price: { priceMinorUnits: 250000, currency: 'BDT' },
  rules: rules(5),
  onIt: 3,
  periodLocked: true,
  retireBlocked: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/plans';
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.listPlansForAdmin.mockResolvedValue({
    ok: true,
    value: {
      available: true,
      plans: [
        plan({}),
        plan({
          id: '00000000-0000-4000-8000-000000000002',
          key: 'agency_founding_access',
          name: 'VisaStack Founding Access',
          bypassLimits: true,
          price: { priceMinorUnits: 0, currency: 'USD' },
          retireBlocked: 'default',
        }),
        plan({
          id: '00000000-0000-4000-8000-000000000003',
          key: 'traveller_free',
          name: 'Traveller Free',
          audience: 'TRAVELLER',
          price: null,
          onIt: 41,
          periodDays: 1,
          retireBlocked: 'traveller',
        }),
      ],
    },
  });
});

describe('Platform > Plans (S29)', () => {
  it('lists each plan with its price, agencies, limits and AI features, with forms to change it', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain('Agency Growth');
    expect(text).toContain('every 30 days');
    expect(text).toContain('3 Agencies');
    expect(text).toContain('1024 MB');
    // AI features are set on Traveller Free only; its limits are not offered (round 2).
    expect(text.match(/On, 15 a Day/g)).toHaveLength(1);
    expect(text).toContain('41 Travellers');
    expect(text).toContain('Every traveller is on this plan, so it cannot be retired.');
    // The internal invitations key is never shown as a limit of its own.
    expect(text).not.toContain('Team Members and Invitations');
    expect(text).toContain('Complimentary');
    expect(text).toContain('Every new agency starts on this plan, so it cannot be retired.');
    expect(text).toContain('New Agency Plan');
    expect(text).toContain('New Traveller Plan');
    // Traveller Free's storage follows the upload settings, named with their numbers (ADR 0025).
    expect(text).toContain('Storage per Person Upload Setting (50 MB)');
    expect(text).toContain(
      'Traveller Free follows the upload settings for storage: 100 MB for the whole account and 50 MB per person.',
    );
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('PLANS_MANAGE');
  });

  it('shows a paid traveller plan with its BDT price, storage and AI rules, as not sold yet (ADR 0025)', async () => {
    mocks.listPlansForAdmin.mockResolvedValue({
      ok: true,
      value: {
        available: true,
        plans: [
          plan({
            id: '00000000-0000-4000-8000-000000000004',
            key: 'traveller_traveller_plus_abc123',
            name: 'Traveller Plus',
            audience: 'TRAVELLER',
            price: { priceMinorUnits: 49900, currency: 'BDT' },
            onIt: 0,
            periodLocked: false,
            rules: {
              account_storage_bytes: { included: true, limit: 500 * 1024 * 1024 },
              person_storage_bytes: { included: true, limit: null },
              'ai.ai_app_suggestions': { included: true, limit: 60 },
            },
          }),
        ],
      },
    });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Traveller Plus For Travellers Price BDT 499.00 for 30 days');
    expect(text).toContain('0 Travellers');
    expect(text).toContain('Not Sold Yet');
    expect(text).not.toContain('Offered');
    expect(text).toContain('Storage for the Whole Account 500 MB');
    expect(text).toContain('Storage per Person Upload Setting (50 MB)');
    expect(text).toContain('AI App Suggestions On, 60 a Day');
    expect(text).toContain('Travellers cannot buy a plan yet');
    // No agency limits on a traveller plan.
    expect(text).not.toContain('Team Members');
    expect(text).toContain('Retire Traveller Plus');
  });

  it('says plans can be changed after the database update, and offers no form until then', async () => {
    mocks.listPlansForAdmin.mockResolvedValue({
      ok: true,
      value: { available: false, plans: [plan({})] },
    });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Plans can be changed after the database update.');
    expect(text).not.toContain('New Agency Plan');
    expect(text).not.toContain('New Traveller Plan');
  });

  it('is restricted to the platform owner', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await renderServer(Page());
    expect(mocks.listPlansForAdmin).not.toHaveBeenCalled();
  });
});
