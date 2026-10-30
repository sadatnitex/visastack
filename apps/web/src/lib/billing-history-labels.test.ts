import { describe, expect, it } from 'vitest';
import { billingHistoryMove, billingHistoryReason } from './billing-history-labels';

describe('billing history wording', () => {
  it('turns the reasons VisaStack stores into plain sentences, never showing "system:"', () => {
    expect(billingHistoryReason('system: overdue 14 days (INV-A1B2C3D4-20261101)')).toBe(
      'Invoice INV-A1B2C3D4-20261101 unpaid 14 days after its due date',
    );
    expect(billingHistoryReason('system: overdue 1 days (INV-1)')).toBe(
      'Invoice INV-1 unpaid 1 day after its due date',
    );
    expect(billingHistoryReason('system: paid')).toBe('Paid in full');
    expect(billingHistoryReason('system: no overdue invoices')).toBe('No unpaid invoices');
    // An automatic reason this page does not know yet falls back safely.
    expect(billingHistoryReason('system: something new')).toBe(
      'Changed automatically by VisaStack',
    );
    expect(billingHistoryReason('system: overdue lots (x)')).toBe(
      'Changed automatically by VisaStack',
    );
  });

  it('shows a reason a person typed as they wrote it', () => {
    expect(billingHistoryReason('late payment agreed by phone')).toBe(
      'late payment agreed by phone',
    );
  });

  it('names both statuses instead of their stored codes', () => {
    expect(billingHistoryMove('GRACE', 'SUSPENDED')).toBe('Grace to Suspended');
    expect(billingHistoryMove(null, 'ACTIVE')).toBe('Opened as Active');
    expect(billingHistoryMove('GRACE', 'SUSPENDED')).not.toMatch(/GRACE|SUSPENDED/);
  });
});
