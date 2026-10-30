import type { AgencyBillingNotice } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ getAgencyBillingNotice: vi.fn() }));
vi.mock('@visastack/services', () => ({ getAgencyBillingNotice: mocks.getAgencyBillingNotice }));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));

const { BillingStatusNotice, loadBillingNotice } = await import('./billing-status-notice');

const ORG = '11111111-2222-4333-8444-555555555555';
const notice = (overrides: Partial<AgencyBillingNotice> = {}): AgencyBillingNotice => ({
  status: 'GRACE',
  setByPerson: false,
  invoiceOwed: true,
  invoiceOverdue: true,
  ...overrides,
});
const render = (value: AgencyBillingNotice | null, admin: boolean, showAction = true) =>
  renderToStaticMarkup(
    <BillingStatusNotice
      notice={value}
      admin={admin}
      organizationId={ORG}
      showAction={showAction}
    />,
  );

describe('the Grace and Suspended notice (S30, audit M4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tells an owner or admin what Grace means, that nothing is deleted, and offers Pay Invoice', () => {
    const html = render(notice(), true);
    expect(html).toContain('<h2 class="billing-status-title"');
    expect(html).toContain('Your Agency Is in Grace');
    expect(html).toContain('Everything still works for now.');
    expect(html).toContain('Nothing is deleted or hidden.');
    expect(html).toContain(`href="/app/agency/${ORG}/plan/invoices"`);
    expect(html).toContain('>Pay Invoice<');
  });

  it('says what Suspended pauses and what still works', () => {
    const html = render(notice({ status: 'SUSPENDED' }), true);
    expect(html).toContain('Your Agency Is Suspended');
    expect(html).toContain('adding cases, team members and files is paused until it is paid');
    expect(html).toContain('Everything already here still works');
  });

  it('never claims an unpaid invoice when a person set the status or nothing is owed', () => {
    const held = [
      notice({ status: 'SUSPENDED', setByPerson: true }),
      notice({ status: 'SUSPENDED', setByPerson: true, invoiceOwed: false, invoiceOverdue: false }),
    ];
    for (const value of held) {
      for (const admin of [true, false]) {
        const html = render(value, admin);
        expect(html).toContain('Your Agency&#x27;s Billing Is on Hold');
        expect(html).toContain(
          'Your agency&#x27;s billing is on hold, so adding cases, team members and files is paused. Nothing is deleted or hidden. Contact VisaStack if you have questions.',
        );
        expect(html).not.toMatch(/invoice is|unpaid|past its due date/i);
      }
    }
    const grace = render(
      notice({ setByPerson: true, invoiceOwed: false, invoiceOverdue: false }),
      true,
    );
    expect(grace).toContain('needs attention');
    expect(grace).not.toMatch(/unpaid|past its due date/i);
  });

  it('offers Pay Invoice only while an invoice is owed', () => {
    expect(render(notice({ status: 'SUSPENDED', setByPerson: true }), true)).toContain(
      'Pay Invoice',
    );
    expect(
      render(notice({ setByPerson: true, invoiceOwed: false, invoiceOverdue: false }), true),
    ).not.toContain('Pay Invoice');
  });

  it('thanks the agency once nothing is overdue, while the daily check has not moved it back', () => {
    for (const status of ['GRACE', 'SUSPENDED'] as const) {
      for (const owed of [true, false]) {
        for (const admin of [true, false]) {
          const html = render(notice({ status, invoiceOwed: owed, invoiceOverdue: false }), admin);
          expect(html).toContain('Your Payment Is In');
          expect(html).toContain(
            'Thank you, your payment is in. Your agency returns to Active at the next daily check.',
          );
          expect(html).not.toContain('Pay Invoice');
          expect(html).not.toMatch(/past its due date|unpaid|paused/i);
        }
      }
    }
  });

  it('gives a member the short version with no money detail and no payment action', () => {
    for (const status of ['GRACE', 'SUSPENDED'] as const) {
      const html = render(notice({ status }), false);
      expect(html).toContain('An owner or admin can');
      expect(html).not.toContain('Pay Invoice');
      expect(html).not.toMatch(/BDT|\d,\d{3}/);
    }
  });

  it('leaves the action out on the Invoices page itself, and shows nothing otherwise', () => {
    expect(render(notice(), true, false)).not.toContain('Pay Invoice');
    expect(render(null, true)).toBe('');
  });

  it('is a labelled region with no accessibility problems', async () => {
    const html = render(notice({ status: 'SUSPENDED' }), true);
    expect(await axeViolations(html)).toEqual([]);
    expect(html).toContain(`aria-labelledby="billing-status-${ORG}"`);
    expect(html).toContain(`id="billing-status-${ORG}"`);
  });

  it('reads the standing through the service and never breaks the page when the read fails', async () => {
    mocks.getAgencyBillingNotice.mockResolvedValueOnce({ ok: true, value: notice() });
    expect(await loadBillingNotice({} as never, 'a', ORG)).toEqual(notice());
    mocks.getAgencyBillingNotice.mockResolvedValueOnce({ ok: true, value: null });
    expect(await loadBillingNotice({} as never, 'a', ORG)).toBeNull();
    mocks.getAgencyBillingNotice.mockResolvedValueOnce({
      ok: false,
      error: { code: 'forbidden', message: 'no' },
    });
    expect(await loadBillingNotice({} as never, 'a', ORG)).toBeNull();
    mocks.getAgencyBillingNotice.mockRejectedValueOnce(new Error('database down'));
    expect(await loadBillingNotice({} as never, 'a', ORG)).toBeNull();
    expect(mocks.getAgencyBillingNotice).toHaveBeenCalledWith(
      {},
      { actorAccountId: 'a', organizationId: ORG },
    );
  });
});
