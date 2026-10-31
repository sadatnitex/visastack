import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  recordPersonRefund: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  recordPersonRefund: mocks.recordPersonRefund,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner', email: 'owner@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.tryEstablishStepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Step-up is not configured here.',
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
const { PERSON_REFUNDS_UNAVAILABLE, REFERENCE_TAKEN } = await import('@visastack/services');
const { recordTravellerRefundAction } = await import('./actions');

const PAGE = '/app/admin/billing/travellers';
const ENTRY = '0f8b6c1e-2d3a-4b5c-8d6e-7f8091a2b3c4';
const HELD = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const KEY = '6f1c2d1e-8a54-4c8f-9d55-0a1b2c3d4e5f';
const SCOPE = { kind: 'staff', platformAction: 'BILLING_REFUND_MANAGE' };
const INITIAL = { ok: true, message: '' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all = {
    sourceKind: 'entry',
    sourceId: ENTRY,
    expectedAmountMinorUnits: '150000',
    invoiceRef: 'TP-A1B2C3D4-1',
    idempotencyKey: KEY,
    reference: 'GW-REFUND-77',
    refundedOn: '2026-10-29',
    reason: 'Asked within 7 days',
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
}

const recorded = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  value: {
    code: 'recorded',
    refundId: 'r1',
    amountMinorUnits: 150000,
    currency: 'BDT',
    outsideWindow: false,
    ...overrides,
  },
});

beforeEach(() => {
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
  mocks.recordPersonRefund.mockResolvedValue(recorded());
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('recordTravellerRefundAction (ADR 0025 T6b)', () => {
  it('refuses anyone but the platform owner, before any check or service call', async () => {
    mocks.staffPrincipal.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'x' },
    });
    const result = await recordTravellerRefundAction(INITIAL, form());
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('Only the platform owner');
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('BILLING_REFUND_MANAGE');
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
    expect(mocks.recordPersonRefund).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in check first, and sends the owner to it and back to this page', async () => {
    mocks.tryEstablishStepUp.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/auth/reauth?returnTo=x',
    });
    await expect(recordTravellerRefundAction(INITIAL, form())).rejects.toThrow(
      'NEXT_REDIRECT:/auth/reauth?returnTo=x',
    );
    expect(mocks.recordPersonRefund).not.toHaveBeenCalled();
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[0]).toMatchObject({
      accountId: 'synthetic-owner',
      action: 'INVOICE_REFUND_RECORD',
      resourceId: ENTRY,
    });
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[1]).toBe(PAGE);
  });

  it('says plainly when the sign-in check is not set up here', async () => {
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'not_configured' });
    const result = await recordTravellerRefundAction(INITIAL, form());
    expect(result).toMatchObject({ ok: false, message: 'Step-up is not configured here.' });
    expect(mocks.recordPersonRefund).not.toHaveBeenCalled();
  });

  it('records with the owner scope, the shown amount, the step-up proved and the form key', async () => {
    const result = await recordTravellerRefundAction(INITIAL, form());
    expect(mocks.recordPersonRefund.mock.calls[0]?.[1]).toEqual(SCOPE);
    expect(mocks.recordPersonRefund.mock.calls[0]?.[2]).toEqual({
      source: { kind: 'entry', invoicePaymentId: ENTRY },
      expectedAmountMinorUnits: 150000,
      reference: 'GW-REFUND-77',
      refundedOn: new Date('2026-10-29T00:00:00Z'),
      reason: 'Asked within 7 days',
      idempotencyKey: KEY,
      stepUpSatisfied: true,
    });
    expect(result).toMatchObject({ ok: true, values: {} });
    expect(result.message).toBe('Refund recorded: BDT 1,500.00 for TP-A1B2C3D4-1.');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it('names a held payment by its own id', async () => {
    await recordTravellerRefundAction(INITIAL, form({ sourceKind: 'held', sourceId: HELD }));
    expect(mocks.recordPersonRefund.mock.calls[0]?.[2]).toMatchObject({
      source: { kind: 'held', paymentAttemptId: HELD },
    });
  });

  it('says when the refund was outside the 7 days', async () => {
    mocks.recordPersonRefund.mockResolvedValue(recorded({ outsideWindow: true }));
    const result = await recordTravellerRefundAction(INITIAL, form());
    expect(result.message).toBe(
      'Refund recorded: BDT 1,500.00 for TP-A1B2C3D4-1. It was outside the 7 days.',
    );
  });

  it('says a form sent twice recorded once', async () => {
    mocks.recordPersonRefund.mockResolvedValue(recorded({ code: 'already_recorded' }));
    const result = await recordTravellerRefundAction(INITIAL, form());
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain('already recorded');
    expect(result.message).toContain('Nothing new was recorded.');
  });

  it('gives a fresh idempotency key with every reply, never the one sent', async () => {
    const first = await recordTravellerRefundAction(INITIAL, form());
    mocks.recordPersonRefund.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: REFERENCE_TAKEN },
    });
    const second = await recordTravellerRefundAction(INITIAL, form());
    const early = await recordTravellerRefundAction(INITIAL, form({ reason: '' }));
    const keys = [first.nextKey, second.nextKey, early.nextKey];
    for (const key of keys) {
      expect(key).toMatch(UUID);
      expect(key).not.toBe(KEY);
    }
    expect(new Set(keys).size).toBe(3);
  });

  it('turns the service refusals into plain words, keeping what was typed', async () => {
    const cases: readonly [string, string, string, string | undefined][] = [
      [
        'not_found',
        'payment not found',
        'We could not find this payment. Reload the page.',
        undefined,
      ],
      [
        'invalid',
        'This page is out of date. Reload it and try again.',
        'This page is out of date. Reload it and try again.',
        undefined,
      ],
      ['invalid', REFERENCE_TAKEN, REFERENCE_TAKEN, 'reference'],
      ['invalid', PERSON_REFUNDS_UNAVAILABLE, PERSON_REFUNDS_UNAVAILABLE, undefined],
      [
        'invalid',
        'The refund day cannot be in the future.',
        'The refund day cannot be in the future.',
        'refundedOn',
      ],
      ['forbidden', 'x', 'Only the platform owner can record a refund for a traveller.', undefined],
    ];
    for (const [code, message, said, field] of cases) {
      mocks.recordPersonRefund.mockResolvedValueOnce({ ok: false, error: { code, message } });
      const result = await recordTravellerRefundAction(INITIAL, form());
      expect(result.ok, said).toBe(false);
      expect(result.message).toBe(said);
      expect(result.field).toBe(field);
      expect(result.values).toEqual({
        reference: 'GW-REFUND-77',
        refundedOn: '2026-10-29',
        reason: 'Asked within 7 days',
      });
    }
    // A refused recording ran, so the page is drawn again to show where things stand.
    expect(mocks.revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it('asks for the sign-in check again if the service still wants one', async () => {
    mocks.recordPersonRefund.mockResolvedValue({
      ok: false,
      error: { code: 'step_up_required', message: 'recording a refund requires reauthentication' },
    });
    const result = await recordTravellerRefundAction(INITIAL, form());
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Confirm it is you again, then record the refund once more.');
    expect(result.message).not.toContain('reauthentication');
  });

  it('checks the typed fields and the page values before any work', async () => {
    const cases: readonly [Record<string, string>, string | undefined, string][] = [
      [{ reference: '' }, 'reference', 'Enter the refund reference, up to 120 characters.'],
      [
        { reference: 'x'.repeat(121) },
        'reference',
        'Enter the refund reference, up to 120 characters.',
      ],
      [{ refundedOn: '2026-02-30' }, 'refundedOn', 'Enter the day the refund was made.'],
      [{ reason: '' }, 'reason', 'Give a reason, up to 500 characters.'],
      [{ sourceKind: 'other' }, undefined, 'This page is out of date. Reload it and try again.'],
      [{ sourceId: '' }, undefined, 'This page is out of date. Reload it and try again.'],
      [
        { expectedAmountMinorUnits: '0' },
        undefined,
        'This page is out of date. Reload it and try again.',
      ],
      [
        { expectedAmountMinorUnits: '15.5' },
        undefined,
        'This page is out of date. Reload it and try again.',
      ],
    ];
    for (const [fields, field, message] of cases) {
      const result = await recordTravellerRefundAction(INITIAL, form(fields));
      expect(result).toMatchObject({ ok: false, message });
      expect(result.field).toBe(field);
    }
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
    expect(mocks.recordPersonRefund).not.toHaveBeenCalled();
  });
});
