import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Recording a decision on a prepared file. A signed-in stranger who knows a case id must get one
 * fixed answer whether the case is real (but not theirs) or made up, before any sign-in
 * confirmation is asked for and before anything is recorded. The real owner is served as before.
 */

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  decideAcknowledgement: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  decideAcknowledgement: mocks.decideAcknowledgement,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'step up',
  tryEstablishStepUp: mocks.tryEstablishStepUp,
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'signed-in' }),
}));

const { decideAcknowledgementAction } = await import('./actions');
const { CASE_HIDDEN_LINE } = await import('../../../../../../lib/hidden-record');

const PREV = { ok: true, message: '' };
function form() {
  const data = new FormData();
  data.set('missionId', 'case-1');
  data.set('snapshotId', 'snap-1');
  data.set('expectedSnapshotChecksum', 'sum');
  data.set('decision', 'ACKNOWLEDGED');
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'ok' });
});

describe('decideAcknowledgementAction and a case that is not the signed-in account’s own', () => {
  it('gives one identical, fixed answer for a real case that is not theirs and a made-up one, and changes nothing', async () => {
    const answers: unknown[] = [];
    const refusals = [
      {
        gate: { code: 'forbidden', message: 'access denied (default_deny)' },
        service: { code: 'forbidden', message: 'not authorized for this case' },
      },
      {
        gate: { code: 'not_found', message: 'record not found' },
        service: { code: 'not_found', message: 'case not found' },
      },
    ];
    for (const refusal of refusals) {
      vi.clearAllMocks();
      mocks.requireAccess.mockResolvedValue({ ok: false, error: refusal.gate });
      mocks.decideAcknowledgement.mockResolvedValue({ ok: false, error: refusal.service });
      mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'ok' });
      answers.push(await decideAcknowledgementAction(PREV, form()));
      expect(mocks.decideAcknowledgement).not.toHaveBeenCalled();
      expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toEqual({ ok: false, message: CASE_HIDDEN_LINE });
  });

  it('gives the fixed answer to someone who sees the case only through a share', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'individual_recipient' } },
    });
    expect(await decideAcknowledgementAction(PREV, form())).toEqual({
      ok: false,
      message: CASE_HIDDEN_LINE,
    });
    expect(mocks.decideAcknowledgement).not.toHaveBeenCalled();
  });

  it('serves the real owner as before: confirms sign-in, records the decision, refreshes the page', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' } },
    });
    mocks.decideAcknowledgement.mockResolvedValue({ ok: true, value: {} });
    expect(await decideAcknowledgementAction(PREV, form())).toEqual({
      ok: true,
      message: 'Prepared file acknowledged.',
    });
    expect(mocks.tryEstablishStepUp).toHaveBeenCalled();
    expect(mocks.decideAcknowledgement).toHaveBeenCalledWith(
      { tag: 'db' },
      expect.objectContaining({ actorAccountId: 'signed-in', missionId: 'case-1' }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/mission/case-1/snapshots/snap-1');
  });

  it('shows the service’s own words to the real owner when it refuses', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' } },
    });
    mocks.decideAcknowledgement.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'This file has changed since you opened it.' },
    });
    expect(await decideAcknowledgementAction(PREV, form())).toEqual({
      ok: false,
      message: 'This file has changed since you opened it.',
    });
  });
});
