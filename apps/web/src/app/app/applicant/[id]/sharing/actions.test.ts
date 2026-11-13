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
  revokeSharingInvitation: vi.fn(),
  listAccessForApplicant: vi.fn(),
  expandGrantScope: vi.fn(),
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
  revokeSharingInvitation: mocks.revokeSharingInvitation,
  listAccessForApplicant: mocks.listAccessForApplicant,
  expandGrantScope: mocks.expandGrantScope,
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
const {
  allowCaseAction,
  createGrantAction,
  expandGrantScopeAction,
  revokeSharingInvitationAction,
  updateGrantAction,
} = await import('./actions');
const { GRANT_HIDDEN_LINE } = await import('../../../../../lib/hidden-record');
const OWNED_PERSON = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirected');
  });
  // The signed-in account owns this person, who holds the grant used below.
  mocks.listAccessForApplicant.mockResolvedValue({ ok: true, value: [{ id: 'owned-grant' }] });
});
function form(op: string) {
  const data = new FormData();
  data.set('grantId', 'owned-grant');
  data.set('applicantId', OWNED_PERSON);
  data.set('op', op);
  return data;
}
describe('sharing transition navigation', () => {
  it.each(['pause', 'resume', 'revoke'] as const)(
    '%s navigates to the committed grant owner route',
    async (op) => {
      const service = mocks[`${op}Grant`];
      service.mockResolvedValue({ ok: true, value: { applicantId: 'actual-applicant' } });
      // The reloaded page says what changed (CCD quiet closure), named by a fixed word.
      const done = { pause: 'paused', resume: 'resumed', revoke: 'revoked' }[op];
      expect(await updateGrantAction({ ok: true, message: '' }, form(op))).toEqual({
        ok: true,
        message: {
          pause: 'Access paused. They cannot see anything until you resume it.',
          resume: 'Access resumed. They can see what you shared again.',
          revoke: 'Access revoked. They lose it on their next request.',
        }[op],
        refreshPath: `/app/applicant/actual-applicant/sharing?done=${done}`,
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

describe('withdrawing an invitation', () => {
  const invitationForm = () => {
    const data = new FormData();
    data.set('invitationId', 'inv-1');
    data.set('applicantId', 'owned');
    return data;
  };

  it('lands on Sharing, which then says the link no longer works', async () => {
    vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'true');
    try {
      mocks.revokeSharingInvitation.mockResolvedValue({ ok: true, value: undefined });
      await expect(revokeSharingInvitationAction(invitationForm())).rejects.toThrow('redirected');
      expect(mocks.redirect).toHaveBeenCalledWith(
        '/app/applicant/owned/sharing?done=invitation-withdrawn',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('says so when it could not be withdrawn, in fixed words, never the reason text', async () => {
    vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'true');
    try {
      mocks.revokeSharingInvitation.mockResolvedValue({
        ok: false,
        error: { message: 'Invitation is no longer pending.' },
      });
      await expect(revokeSharingInvitationAction(invitationForm())).rejects.toThrow('redirected');
      expect(mocks.redirect).toHaveBeenCalledWith(
        '/app/applicant/owned/sharing?done=invitation-not-withdrawn',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('a stranger cannot tell a real grant from a made-up one', () => {
  const OWN_WORDS = 'The service says this in its own words.';
  const hiddenGrantForms = {
    'a real grant of someone else': {
      // The person is not theirs, so the list of that person's access is refused.
      listed: { ok: false, error: { code: 'forbidden', message: 'not authorized' } },
      applicantId: OWNED_PERSON,
      service: { code: 'forbidden', message: 'only the applicant owner can change this grant' },
    },
    'a real grant tried with their own person': {
      listed: { ok: true, value: [{ id: 'their-own-grant' }] },
      applicantId: OWNED_PERSON,
      service: { code: 'forbidden', message: 'only the applicant owner can change this grant' },
    },
    'a made-up grant': {
      listed: { ok: true, value: [{ id: 'their-own-grant' }] },
      applicantId: OWNED_PERSON,
      service: { code: 'not_found', message: 'grant not found' },
    },
    'a made-up person': {
      listed: { ok: false, error: { code: 'forbidden', message: 'not authorized' } },
      applicantId: '22222222-2222-4222-8222-222222222222',
      service: { code: 'not_found', message: 'grant not found' },
    },
    'a person that is not an id at all': {
      listed: { ok: false, error: { code: 'forbidden', message: 'not authorized' } },
      applicantId: 'untrusted-route',
      service: { code: 'not_found', message: 'grant not found' },
    },
  } as const;
  const strangerForm = (applicantId: string, op?: string) => {
    const data = new FormData();
    data.set('grantId', 'victim-grant');
    data.set('applicantId', applicantId);
    if (op) data.set('op', op);
    data.append('documentId', 'doc-1');
    return data;
  };

  describe.each(['revoke', 'pause', 'resume'] as const)('updateGrantAction (%s)', (op) => {
    it('gives one identical, fixed answer in every stranger case, and changes nothing', async () => {
      const answers: unknown[] = [];
      for (const scenario of Object.values(hiddenGrantForms)) {
        vi.clearAllMocks();
        mocks.listAccessForApplicant.mockResolvedValue(scenario.listed);
        for (const service of [mocks.revokeGrant, mocks.pauseGrant, mocks.resumeGrant]) {
          service.mockResolvedValue({ ok: false, error: scenario.service });
        }
        answers.push(
          await updateGrantAction(
            { ok: true, message: '' },
            strangerForm(scenario.applicantId, op),
          ),
        );
        expect(mocks.revokeGrant).not.toHaveBeenCalled();
        expect(mocks.pauseGrant).not.toHaveBeenCalled();
        expect(mocks.resumeGrant).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
      }
      for (const answer of answers)
        expect(answer).toEqual({ ok: false, message: GRANT_HIDDEN_LINE });
    });

    it('serves the real owner as before: the service runs and speaks in its own words', async () => {
      mocks[`${op}Grant`].mockResolvedValue({ ok: false, error: { message: OWN_WORDS } });
      expect(await updateGrantAction({ ok: true, message: '' }, form(op))).toEqual({
        ok: false,
        message: OWN_WORDS,
      });
      expect(mocks[`${op}Grant`]).toHaveBeenCalledWith(
        {},
        { actorAccountId: 'owner', grantId: 'owned-grant' },
      );
    });
  });

  describe('expandGrantScopeAction', () => {
    it('gives one identical, fixed answer in every stranger case, and changes nothing', async () => {
      const answers: unknown[] = [];
      for (const scenario of Object.values(hiddenGrantForms)) {
        vi.clearAllMocks();
        mocks.listAccessForApplicant.mockResolvedValue(scenario.listed);
        mocks.expandGrantScope.mockResolvedValue({ ok: false, error: scenario.service });
        answers.push(
          await expandGrantScopeAction(
            { ok: true, message: '' },
            strangerForm(scenario.applicantId),
          ),
        );
        expect(mocks.expandGrantScope).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
      }
      for (const answer of answers)
        expect(answer).toEqual({ ok: false, message: GRANT_HIDDEN_LINE });
    });

    it('serves the real owner as before: adds the documents, or shows the service\u2019s own words', async () => {
      const data = new FormData();
      data.set('grantId', 'owned-grant');
      data.set('applicantId', OWNED_PERSON);
      data.append('documentId', 'doc-1');
      mocks.expandGrantScope.mockResolvedValue({ ok: true, value: {} });
      expect(await expandGrantScopeAction({ ok: true, message: '' }, data)).toEqual({
        ok: true,
        message: '1 document added to this grant.',
      });
      expect(mocks.expandGrantScope).toHaveBeenCalledWith(
        {},
        { actorAccountId: 'owner', grantId: 'owned-grant', documentIds: ['doc-1'] },
      );
      expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/applicant/${OWNED_PERSON}/sharing`);
      mocks.expandGrantScope.mockResolvedValue({ ok: false, error: { message: OWN_WORDS } });
      expect(await expandGrantScopeAction({ ok: true, message: '' }, data)).toEqual({
        ok: false,
        message: OWN_WORDS,
      });
    });
  });
});
