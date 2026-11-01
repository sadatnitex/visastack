import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  decideRemovalRequest: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
  switchOn: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  decideRemovalRequest: mocks.decideRemovalRequest,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'staff-1', email: 'staff@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../lib/env', () => ({ documentRemovalRequestsOn: mocks.switchOn }));
vi.mock('../../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.tryEstablishStepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Step-up is not configured here.',
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { decideRemovalAction } from './actions';

const ID = '11111111-1111-4111-8111-111111111111';
const INITIAL = { ok: true, message: '' };
const SCOPE = { kind: 'staff', platformAction: 'RETENTION_PURGE' };
const stepUpNeeded = { ok: false, error: { code: 'step_up_required', message: 'x' } };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ requestId: ID, ...fields })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.switchOn.mockReturnValue(true);
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
});

describe('deciding a removal request', () => {
  it('does nothing while the switch is off', async () => {
    mocks.switchOn.mockReturnValue(false);
    const result = await decideRemovalAction(INITIAL, form({ decision: 'APPROVE' }));
    expect(result.ok).toBe(false);
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
  });

  it('needs the compliance role (RETENTION_PURGE)', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await decideRemovalAction(INITIAL, form({ decision: 'APPROVE' }));
    expect(result.ok).toBe(false);
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('RETENTION_PURGE');
    expect(mocks.decideRemovalRequest).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in, then approves with it', async () => {
    mocks.decideRemovalRequest.mockResolvedValueOnce(stepUpNeeded).mockResolvedValueOnce({
      ok: true,
      value: { decision: 'APPROVED', removal: 'QUEUED', openCasesUpdated: 1, agenciesTold: 1 },
    });
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'established' });
    const result = await decideRemovalAction(INITIAL, form({ decision: 'APPROVE' }));
    expect(result).toEqual({
      ok: true,
      message: 'Approved. The file is being removed securely. The person has been told.',
    });
    expect(mocks.decideRemovalRequest.mock.calls[0]?.[1]).toEqual({
      id: ID,
      decision: 'APPROVE',
      stepUpSatisfied: false,
    });
    expect(mocks.decideRemovalRequest.mock.calls[1]?.[1]).toMatchObject({ stepUpSatisfied: true });
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[0]).toMatchObject({
      action: 'DOCUMENT_REMOVAL_DECIDE',
      resourceId: ID,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/admin/removals');
  });

  it('sends staff to sign in again when the check is not fresh', async () => {
    mocks.decideRemovalRequest.mockResolvedValueOnce(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'reauth_required', reauthUrl: '/reauth' });
    await expect(decideRemovalAction(INITIAL, form({ decision: 'APPROVE' }))).rejects.toThrow(
      'NEXT_REDIRECT:/reauth',
    );
    expect(mocks.decideRemovalRequest).toHaveBeenCalledTimes(1);
  });

  it('needs a reason to decline', async () => {
    const result = await decideRemovalAction(
      INITIAL,
      form({ decision: 'DECLINE', decisionCode: '' }),
    );
    expect(result).toMatchObject({ ok: false, field: 'decisionCode' });
    expect(mocks.decideRemovalRequest).not.toHaveBeenCalled();
    mocks.decideRemovalRequest.mockResolvedValue({
      ok: true,
      value: { decision: 'DECLINED', decisionCode: 'LEGAL_HOLD' },
    });
    const declined = await decideRemovalAction(
      INITIAL,
      form({ decision: 'DECLINE', decisionCode: 'LEGAL_HOLD' }),
    );
    expect(declined.ok).toBe(true);
    expect(mocks.decideRemovalRequest.mock.calls[0]?.[1]).toMatchObject({
      decision: 'DECLINE',
      decisionCode: 'LEGAL_HOLD',
    });
  });

  it('explains a refusal under a legal hold', async () => {
    mocks.decideRemovalRequest.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'a legal hold covers this document' },
    });
    const result = await decideRemovalAction(INITIAL, form({ decision: 'APPROVE' }));
    expect(result.message).toContain('legal hold');
  });
});
