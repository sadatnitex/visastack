import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  getBillingSettings: vi.fn(),
  previewOverdueHandling: vi.fn(),
}));

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
  getBillingSettings: (...args: unknown[]) => mocks.getBillingSettings(...args),
  previewOverdueHandling: (...args: unknown[]) => mocks.previewOverdueHandling(...args),
}));
vi.mock('./forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { BillingRulesForm: stub('BillingRulesForm') };
});

const { default: Page } = await import('./page');

const settings = {
  available: true,
  dueDays: 7,
  overdueHandlingEnabled: false,
  graceAfterDays: 7,
  suspendAfterDays: 30,
  invoicingStartsAt: new Date('2026-10-29T09:00:00Z'),
  updatedByAccountId: null,
  updatedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/billing';
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.getBillingSettings.mockResolvedValue({ ok: true, value: settings });
  mocks.previewOverdueHandling.mockResolvedValue({
    ok: true,
    value: { toGrace: 1, toSuspended: 0 },
  });
});

describe('Platform > Billing Rules', () => {
  it('shows the rules, what each status does, and who switching on would move today', async () => {
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain('Billing Rules');
    expect(text).toContain('Automatic Grace and Suspended');
    expect(text).toContain(
      'Paying in full ends a Grace or Suspended status that VisaStack set. A status a person set is never changed automatically.',
    );
    expect(text).toContain(
      'With the saved day counts: Turning this on today moves 1 agency to Grace and 0 agencies to Suspended.',
    );
    expect(text).toContain('a traveller who shares records with it also cannot add new files');
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('BILLING_SETTINGS_MANAGE');
    // Both reads take the owner's scope.
    expect(mocks.getBillingSettings.mock.calls[0]?.[1]).toEqual({ kind: 'staff' });
    expect(mocks.previewOverdueHandling.mock.calls[0]?.[1]).toEqual({ kind: 'staff' });
  });

  it('is restricted to the platform owner', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = await renderServer(Page({}));
    expect(mocks.getBillingSettings).not.toHaveBeenCalled();
    expect(textOf(html)).not.toContain('Change the Rules');
  });

  it('says plainly that nothing runs before the rules are available', async () => {
    mocks.getBillingSettings.mockResolvedValue({
      ok: true,
      value: { ...settings, available: false },
    });
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('VisaStack creates no invoices on its own');
    expect(text).not.toContain('Change the Rules');
  });

  it('offers the monthly accounting file, also before the rules are available, and says why a download was refused (S18)', async () => {
    const html = await renderServer(Page({}));
    expect(textOf(html)).toContain('Monthly Accounting File');
    expect(html).toContain('action="/app/admin/billing/ledger"');
    expect(html).toContain('Download Accounting File (CSV)');
    expect(html.match(/<h1/g)).toHaveLength(1);
    mocks.getBillingSettings.mockResolvedValue({
      ok: true,
      value: { ...settings, available: false },
    });
    const refused = textOf(
      await renderServer(Page({ searchParams: Promise.resolve({ ledger: 'too_many' }) })),
    );
    expect(refused).toContain('Download Accounting File (CSV)');
    expect(refused).toContain('more than one file can hold');
    const refusedHtml = await renderServer(
      Page({ searchParams: Promise.resolve({ ledger: 'month' }) }),
    );
    expect(refusedHtml).toContain('aria-describedby="ledger-month-hint ledger-problem"');
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(textOf(await renderServer(Page({})))).not.toContain('Download Accounting File (CSV)');
  });
});
