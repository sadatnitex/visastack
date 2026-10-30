import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ getBillingAccountForOrganization: vi.fn() }));
vi.mock('@visastack/services', () => ({
  getBillingAccountForOrganization: mocks.getBillingAccountForOrganization,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));

const { BillingStatusNotice, loadNoticeBillingStatus } = await import('./billing-status-notice');

const ORG = '11111111-2222-4333-8444-555555555555';
const render = (status: 'GRACE' | 'SUSPENDED' | null, admin: boolean, showAction = true) =>
  renderToStaticMarkup(
    <BillingStatusNotice
      status={status}
      admin={admin}
      organizationId={ORG}
      showAction={showAction}
    />,
  );

describe('the Grace and Suspended notice (S30, audit M4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tells an owner or admin what Grace means, that nothing is deleted, and offers Pay Invoice', () => {
    const html = render('GRACE', true);
    expect(html).toContain('Your Agency Is in Grace');
    expect(html).toContain('Everything still works for now.');
    expect(html).toContain('Nothing is deleted or hidden.');
    expect(html).toContain(`href="/app/agency/${ORG}/plan/invoices"`);
    expect(html).toContain('>Pay Invoice<');
  });

  it('says what Suspended pauses and what still works', () => {
    const html = render('SUSPENDED', true);
    expect(html).toContain('Your Agency Is Suspended');
    expect(html).toContain('adding cases, team members and files is paused until it is paid');
    expect(html).toContain('Everything already here still works');
  });

  it('gives a member the short version with no money detail and no payment action', () => {
    for (const status of ['GRACE', 'SUSPENDED'] as const) {
      const html = render(status, false);
      expect(html).toContain('An owner or admin can');
      expect(html).not.toContain('Pay Invoice');
      expect(html).not.toMatch(/BDT|\d,\d{3}/);
    }
  });

  it('leaves the action out on the Invoices page itself, and shows nothing for other statuses', () => {
    expect(render('GRACE', true, false)).not.toContain('Pay Invoice');
    expect(render(null, true)).toBe('');
  });

  it('is a labelled region with no accessibility problems', async () => {
    const html = render('SUSPENDED', true);
    expect(await axeViolations(html)).toEqual([]);
    expect(html).toContain(`aria-labelledby="billing-status-${ORG}"`);
    expect(html).toContain(`id="billing-status-${ORG}"`);
  });

  it('reads only Grace and Suspended, and never breaks the page when the read fails', async () => {
    const read = (status: string | null) =>
      mocks.getBillingAccountForOrganization.mockResolvedValueOnce({
        ok: true,
        value: status ? { status } : undefined,
      });
    read('GRACE');
    expect(await loadNoticeBillingStatus({} as never, 'a', ORG)).toBe('GRACE');
    read('SUSPENDED');
    expect(await loadNoticeBillingStatus({} as never, 'a', ORG)).toBe('SUSPENDED');
    for (const other of ['ACTIVE', 'TRIAL', 'CLOSED', null]) {
      read(other);
      expect(await loadNoticeBillingStatus({} as never, 'a', ORG)).toBeNull();
    }
    mocks.getBillingAccountForOrganization.mockResolvedValueOnce({
      ok: false,
      error: { code: 'forbidden', message: 'no' },
    });
    expect(await loadNoticeBillingStatus({} as never, 'a', ORG)).toBeNull();
    mocks.getBillingAccountForOrganization.mockRejectedValueOnce(new Error('database down'));
    expect(await loadNoticeBillingStatus({} as never, 'a', ORG)).toBeNull();
    expect(mocks.getBillingAccountForOrganization).toHaveBeenCalledWith(
      {},
      { actorAccountId: 'a', organizationId: ORG },
    );
  });
});
