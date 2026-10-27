import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pauseGrant: vi.fn(),
  resumeGrant: vi.fn(),
  revokeGrant: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  createGrant: vi.fn(),
  getAccountByEmail: vi.fn(),
  requireAccess: vi.fn(),
  removeCaseException: vi.fn(),
  establishStepUpProof: vi.fn(),
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  pauseGrant: mocks.pauseGrant,
  resumeGrant: mocks.resumeGrant,
  revokeGrant: mocks.revokeGrant,
  createGrant: mocks.createGrant,
  getAccountByEmail: mocks.getAccountByEmail,
  requireAccess: mocks.requireAccess,
  removeCaseException: mocks.removeCaseException,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../../../lib/jobs', () => ({ triggerNotificationWorker: vi.fn() }));
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: vi.fn() }));
vi.mock('../../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Confirmation unavailable.',
  tryEstablishStepUp: vi.fn(),
  establishStepUpProof: mocks.establishStepUpProof,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
const { allowCaseAction, createGrantAction, updateGrantAction } = await import('./actions');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirected');
  });
});
function form(op: string) {
  const data = new FormData();
  data.set('grantId', 'owned-grant');
  data.set('applicantId', 'untrusted-route');
  data.set('op', op);
  return data;
}
describe('sharing transition navigation', () => {
  it.each(['pause', 'resume', 'revoke'] as const)(
    '%s navigates to the committed grant owner route',
    async (op) => {
      const service = mocks[`${op}Grant`];
      service.mockResolvedValue({ ok: true, value: { applicantId: 'actual-applicant' } });
      expect(await updateGrantAction({ ok: true, message: '' }, form(op))).toEqual({
        ok: true,
        message: 'Access updated.',
        refreshPath: '/app/applicant/actual-applicant/sharing',
      });
      expect(service).toHaveBeenCalledWith({}, { actorAccountId: 'owner', grantId: 'owned-grant' });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
  it('keeps service refusal visible without navigating', async () => {
    mocks.resumeGrant.mockResolvedValue({ ok: false, error: { message: 'Access has expired.' } });
    expect(await updateGrantAction({ ok: true, message: '' }, form('resume'))).toEqual({
      ok: false,
      message: 'Access has expired.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('safe copies stay grantable (stored as DOWNLOAD_REDACTED)', () => {
  function grantForm(actions: readonly string[]) {
    const data = new FormData();
    data.set('applicantId', 'owned-person');
    data.set('recipientEmail', 'synthetic@example.com');
    data.set('purpose', 'Visa review');
    for (const action of actions) data.append('action', action);
    return data;
  }
  beforeEach(() => {
    mocks.getAccountByEmail.mockResolvedValue({ id: 'recipient' });
    mocks.createGrant.mockResolvedValue({ ok: true, value: {} });
  });

  it('accepts the action and passes it to the grant unchanged', async () => {
    const result = await createGrantAction(
      { ok: true, message: '' },
      grantForm(['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED']),
    );
    expect(result).toEqual({
      ok: true,
      message:
        'Shared. They see only what you chose, and only after they accept. You can stop it at any time below.',
    });
    expect(mocks.createGrant).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ actions: ['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED'] }),
    );
  });
});

describe('Allow This Case', () => {
  const proof = { applicant: { id: 'owned-person' } };
  function allowForm() {
    const data = new FormData();
    data.set('applicantId', 'owned-person');
    data.set('missionId', 'case-2');
    data.set('grantId', 'grant-a');
    return data;
  }
  const start = { ok: true, message: '' } as const;

  it('checks the case through the access gate as its owner, then removes the exception', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: true, value: proof });
    mocks.removeCaseException.mockResolvedValue({ ok: true, value: {} });
    expect(await allowCaseAction(start, allowForm())).toEqual({
      ok: true,
      message: 'This case is shared again.',
      refreshPath: '/app/applicant/owned-person/sharing',
    });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'account', accountId: 'owner' }),
      'MANAGE',
      { missionId: 'case-2' },
      { purpose: 'owner_case_sharing' },
    );
    expect(mocks.removeCaseException).toHaveBeenCalledWith(proof, { grantId: 'grant-a' });
    expect(mocks.establishStepUpProof).not.toHaveBeenCalled();
  });

  it('refuses when the gate refuses or the case belongs to someone else', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    mocks.requireAccess.mockResolvedValueOnce({
      ok: true,
      value: { applicant: { id: 'someone-else' } },
    });
    for (let i = 0; i < 2; i++) {
      expect(await allowCaseAction(start, allowForm())).toEqual({
        ok: false,
        message: 'Not authorized.',
      });
    }
    expect(mocks.removeCaseException).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in only when the service says the access needs one', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: true, value: proof });
    mocks.removeCaseException
      .mockResolvedValueOnce({ ok: false, error: { code: 'step_up_required', message: 'x' } })
      .mockResolvedValueOnce({ ok: true, value: {} });
    mocks.establishStepUpProof.mockResolvedValue({ kind: 'proof', proof: 'step-up' });
    expect((await allowCaseAction(start, allowForm())).ok).toBe(true);
    expect(mocks.establishStepUpProof).toHaveBeenCalledWith(
      { accountId: 'owner', action: 'SHARE', resourceId: 'owned-person' },
      '/app/applicant/owned-person/sharing',
    );
    expect(mocks.removeCaseException).toHaveBeenLastCalledWith(proof, {
      grantId: 'grant-a',
      stepUp: 'step-up',
    });

    mocks.removeCaseException.mockResolvedValue({
      ok: false,
      error: { code: 'step_up_required', message: 'x' },
    });
    mocks.establishStepUpProof.mockResolvedValue({ kind: 'reauth_required', reauthUrl: '/re' });
    await expect(allowCaseAction(start, allowForm())).rejects.toThrow('redirected');
    expect(mocks.redirect).toHaveBeenCalledWith('/re');

    mocks.establishStepUpProof.mockResolvedValue({ kind: 'not_configured' });
    expect(await allowCaseAction(start, allowForm())).toEqual({
      ok: false,
      message: 'Confirmation unavailable.',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
  });
});
