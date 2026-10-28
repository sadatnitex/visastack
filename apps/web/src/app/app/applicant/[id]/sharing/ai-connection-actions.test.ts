import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  turnOffAiConnection: vi.fn(),
  changeAiConnection: vi.fn(),
  establishStepUpProof: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  turnOffAiConnection: mocks.turnOffAiConnection,
  changeAiConnection: mocks.changeAiConnection,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Confirmation unavailable.',
  establishStepUpProof: mocks.establishStepUpProof,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({
      db: { transaction: (work: (tx: unknown) => Promise<unknown>) => work('tx') },
      accountId: 'owner',
    }),
}));
const { changeAiAccessAction, turnOffAiConnectionAction } = await import('./ai-connection-actions');

const APPLICANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const CASE = '33333333-3333-4333-8333-333333333333';
const OWNER_PROOF = { actor: { kind: 'applicant_owner' } };
const NONE = { ok: true, message: '' };

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  data.set('applicantId', APPLICANT);
  data.set('connectionId', CONNECTION);
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  }
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('AI_CONNECTOR_ENABLED', 'true');
  mocks.requireAccess.mockResolvedValue({ ok: true, value: OWNER_PROOF });
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`redirected:${url}`);
  });
});

describe('Turn Off', () => {
  it('turns the connection off through the owner gate and reloads the Sharing page', async () => {
    mocks.turnOffAiConnection.mockResolvedValue({ ok: true, value: { alreadyOff: false } });
    vi.stubEnv('AI_CONNECTOR_ENABLED', 'false');
    const result = await turnOffAiConnectionAction(NONE, form({}));
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      'tx',
      expect.anything(),
      'VIEW_METADATA',
      { applicantId: APPLICANT },
      { purpose: 'ai_connection' },
    );
    expect(mocks.turnOffAiConnection).toHaveBeenCalledWith(OWNER_PROOF, {
      connectionId: CONNECTION,
    });
    expect(result).toMatchObject({
      ok: true,
      refreshPath: `/app/applicant/${APPLICANT}/sharing?ai=off#ai-connections`,
    });
  });

  it('refuses anyone but the owner, and a malformed id, before the service', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: true, value: { actor: { kind: 'grant' } } });
    expect((await turnOffAiConnectionAction(NONE, form({}))).ok).toBe(false);
    const bad = new FormData();
    bad.set('applicantId', APPLICANT);
    bad.set('connectionId', 'not-an-id');
    expect((await turnOffAiConnectionAction(NONE, bad)).ok).toBe(false);
    expect(mocks.turnOffAiConnection).not.toHaveBeenCalled();
  });
});

describe('Change Access', () => {
  const choices = {
    layer: ['identity', 'money', 'not-a-layer'],
    cases: CASE,
    document_list: 'on',
    duration: '7d',
  };

  it('saves the checked choices and reloads the Sharing page', async () => {
    mocks.changeAiConnection.mockResolvedValue({ ok: true, value: { expiresAt: null } });
    const result = await changeAiAccessAction(NONE, form(choices));
    expect(mocks.changeAiConnection).toHaveBeenCalledWith(OWNER_PROOF, {
      connectionId: CONNECTION,
      choices: {
        layers: ['identity', 'money'],
        caseMode: 'ONE',
        missionId: CASE,
        documentList: true,
        documentText: false,
        revealIdentifiers: false,
        duration: '7d',
      },
    });
    expect(mocks.establishStepUpProof).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      refreshPath: `/app/applicant/${APPLICANT}/sharing?ai=changed#ai-connections`,
    });
  });

  it('asks for a fresh check only when the service needs one, keeping the choices, then tries again', async () => {
    const needsCheck = { ok: false, error: { code: 'step_up_required' } };
    mocks.changeAiConnection.mockResolvedValue(needsCheck);
    mocks.establishStepUpProof.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/reauth',
    });
    await expect(
      changeAiAccessAction(NONE, form({ ...choices, reveal_identifiers: 'on' })),
    ).rejects.toThrow('redirected:/reauth');
    // Tried once without a check; the check returns to this row with the same choices.
    expect(mocks.changeAiConnection).toHaveBeenCalledTimes(1);
    const [request, back] = mocks.establishStepUpProof.mock.calls[0] ?? [];
    expect(request).toEqual({
      accountId: 'owner',
      action: 'EXPORT_PROFILE',
      resourceId: APPLICANT,
    });
    expect(back).toContain(`/app/applicant/${APPLICANT}/sharing?ai_change=${CONNECTION}&`);
    expect(back).toMatch(/#ai-connections$/);
    expect(back).toContain('choice_reveal=1');
    expect(back).toContain('choice_duration=7d');

    const proof = { kind: 'step-up' };
    mocks.changeAiConnection.mockReset();
    mocks.changeAiConnection
      .mockResolvedValueOnce(needsCheck)
      .mockResolvedValueOnce({ ok: true, value: { expiresAt: null } });
    mocks.establishStepUpProof.mockResolvedValue({ kind: 'proof', proof });
    const saved = await changeAiAccessAction(NONE, form({ ...choices, reveal_identifiers: 'on' }));
    expect(saved.ok).toBe(true);
    expect(mocks.changeAiConnection.mock.calls[0]?.[1]).not.toHaveProperty('stepUp');
    expect(mocks.changeAiConnection.mock.calls[1]?.[1]).toMatchObject({ stepUp: proof });
  });

  it('keeping Full Document Numbers on, or turning it off, needs no check', async () => {
    mocks.changeAiConnection.mockResolvedValue({ ok: true, value: { expiresAt: null } });
    await changeAiAccessAction(NONE, form({ ...choices, reveal_identifiers: 'on' }));
    await changeAiAccessAction(NONE, form(choices));
    expect(mocks.establishStepUpProof).not.toHaveBeenCalled();
    expect(mocks.changeAiConnection).toHaveBeenCalledTimes(2);
  });

  it('gives the submitted choices back with a failure, so a retry saves what was chosen', async () => {
    mocks.changeAiConnection.mockResolvedValue({
      ok: false,
      error: { code: 'case_not_on_record' },
    });
    const result = await changeAiAccessAction(NONE, form({ ...choices, document_text: 'on' }));
    expect(result).toMatchObject({ ok: false, field: 'cases' });
    expect(result.choices).toEqual({
      layers: ['identity', 'money'],
      cases: CASE,
      documentList: true,
      documentText: true,
      revealIdentifiers: false,
      duration: '7d',
    });
  });

  it('names the field at fault and refuses while connecting is off', async () => {
    expect(
      await changeAiAccessAction(NONE, form({ ...choices, duration: 'forever' })),
    ).toMatchObject({ ok: false, field: 'duration' });
    expect(await changeAiAccessAction(NONE, form({ ...choices, cases: 'x' }))).toMatchObject({
      ok: false,
      field: 'cases',
    });
    // Still refused after the check (for example the record changed hands in between).
    mocks.changeAiConnection.mockResolvedValue({ ok: false, error: { code: 'step_up_required' } });
    mocks.establishStepUpProof.mockResolvedValue({ kind: 'proof', proof: {} });
    expect(await changeAiAccessAction(NONE, form(choices))).toMatchObject({
      ok: false,
      field: 'reveal_identifiers',
    });
    vi.stubEnv('AI_CONNECTOR_ENABLED', 'false');
    mocks.changeAiConnection.mockClear();
    expect((await changeAiAccessAction(NONE, form(choices))).ok).toBe(false);
    expect(mocks.changeAiConnection).not.toHaveBeenCalled();
  });
});
