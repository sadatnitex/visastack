import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  requireAccess: vi.fn(),
  confirmEvidenceAnswers: vi.fn(),
  revalidatePath: vi.fn(),
  triggerNotificationWorker: vi.fn(),
  afterCallbacks: [] as Array<() => unknown>,
}));
vi.mock('@visastack/services', () => ({
  MAX_ANSWERS_PER_CONFIRMATION: 25,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  getApplicant: mocks.getApplicant,
  requireAccess: mocks.requireAccess,
  confirmEvidenceAnswers: mocks.confirmEvidenceAnswers,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
// `after` queues its work for after the response; the test runs the queue by hand.
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => {
    mocks.afterCallbacks.push(callback);
  },
}));
vi.mock('../../../../../../lib/jobs', () => ({
  triggerNotificationWorker: mocks.triggerNotificationWorker,
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'owner' }),
}));

const { confirmAnswersAction } = await import('./actions');

const KEY = 'k9Qm2x_T7vLw4Rz0Hc8Yb1Nd';
const PREV = { ok: true, message: '', sent: 0, changed: 0 };
const A1 = 'r1|d1|v1';
const A2 = 'r2|d2|v2';

const form = (answers: string[], over: Record<string, string> = {}) => {
  const data = new FormData();
  const base: Record<string, string> = {
    applicantId: 'a1',
    organizationId: 'org-1',
    confirmationKey: KEY,
    ...over,
  };
  for (const [key, value] of Object.entries(base)) data.set(key, value);
  for (const answer of answers) data.append('answer', answer);
  return data;
};
const confirmation = (over: Record<string, unknown> = {}) => ({
  ok: true,
  value: {
    organizationId: 'org-1',
    organizationName: 'TEST Agency Unrelated',
    outcomes: [],
    sent: 0,
    alreadySent: 0,
    changed: 0,
    ...over,
  },
});
const runAfter = async () => {
  for (const callback of mocks.afterCallbacks.splice(0)) await callback();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.triggerNotificationWorker.mockResolvedValue(undefined);
  mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'owner' });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { gate: 'proof' } });
});

describe('confirmAnswersAction: what it says', () => {
  it('says how many answers went, when every one did, and tells the agency now', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 3 }));
    const result = await confirmAnswersAction(PREV, form([A1, A2, 'r3|d3|v3']));
    expect(result).toMatchObject({
      ok: true,
      message: '3 answers were sent to TEST Agency Unrelated.',
      sent: 3,
      changed: 0,
    });
    expect(result.savedAt).toEqual(expect.any(String));
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/a1/evidence');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/a1/evidence/answer');
    await runAfter();
    expect(mocks.triggerNotificationWorker).toHaveBeenCalledTimes(1);
  });

  it('uses the singular for one answer', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 1 }));
    const result = await confirmAnswersAction(PREV, form([A1]));
    expect(result.message).toBe('1 answer was sent to TEST Agency Unrelated.');
  });

  it('counts an answer this same confirmation already sent as sent, so a repeat is a success', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ alreadySent: 2 }));
    const result = await confirmAnswersAction(PREV, form([A1, A2]));
    expect(result).toMatchObject({
      ok: true,
      message: '2 answers were sent to TEST Agency Unrelated.',
      sent: 2,
    });
  });

  it('says plainly what was not sent when some answers changed, and asks to check and send again', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 2, changed: 1 }));
    const result = await confirmAnswersAction(PREV, form([A1, A2, 'r3|d3|v3']));
    expect(result).toMatchObject({
      ok: true,
      message:
        '2 answers were sent to TEST Agency Unrelated. 1 was not sent because your records changed after you opened this page. Check the list below and send again.',
      sent: 2,
      changed: 1,
    });
    await runAfter();
    expect(mocks.triggerNotificationWorker).toHaveBeenCalledTimes(1);
  });

  it('uses the plural for several that were not sent', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 1, changed: 2 }));
    const result = await confirmAnswersAction(PREV, form([A1, A2, 'r3|d3|v3']));
    expect(result.message).toContain('2 were not sent because your records changed');
  });

  it('is a failure, and sends nothing to the worker, when nothing was sent', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ changed: 2 }));
    const result = await confirmAnswersAction(PREV, form([A1, A2]));
    expect(result).toEqual({
      ok: false,
      message:
        'Nothing was sent. Your records changed after you opened this page. Check the list and try again.',
      sent: 0,
      changed: 2,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    await runAfter();
    expect(mocks.triggerNotificationWorker).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'not_found'])(
    'says the page is out of date when the service says %s',
    async (code) => {
      mocks.confirmEvidenceAnswers.mockResolvedValue({ ok: false, error: { code, message: 'x' } });
      const result = await confirmAnswersAction(PREV, form([A1]));
      expect(result).toEqual({
        ok: false,
        message: 'This page is out of date. Refresh it and choose again.',
        sent: 0,
        changed: 0,
      });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it('never shows a service sentence for any other refusal', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue({
      ok: false,
      error: { code: 'internal', message: 'select * from secrets' },
    });
    const result = await confirmAnswersAction(PREV, form([A1]));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Nothing was sent. Something went wrong on our side.');
  });
});

describe('confirmAnswersAction: who may send, and what it sends', () => {
  it('sends the parsed answers for the agency and key the page named, as the owner', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 2 }));
    await confirmAnswersAction(PREV, form([A1, A2]));
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      { tag: 'db' },
      { kind: 'account', accountId: 'owner' },
      'MANAGE',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
    expect(mocks.confirmEvidenceAnswers).toHaveBeenCalledWith(
      { gate: 'proof' },
      {
        organizationId: 'org-1',
        confirmationKey: KEY,
        answers: [
          { requestId: 'r1', documentId: 'd1', documentVersionId: 'v1' },
          { requestId: 'r2', documentId: 'd2', documentVersionId: 'v2' },
        ],
      },
    );
  });

  it('refuses, reading nothing, when the person is not the owner', async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'someone-else' });
    const result = await confirmAnswersAction(PREV, form([A1]));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('This page is out of date. Refresh it and choose again.');
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.confirmEvidenceAnswers).not.toHaveBeenCalled();
  });

  it('refuses when the traveller does not exist, or the access gate says no', async () => {
    mocks.getApplicant.mockResolvedValue(null);
    expect((await confirmAnswersAction(PREV, form([A1]))).ok).toBe(false);
    mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'owner' });
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect((await confirmAnswersAction(PREV, form([A1]))).ok).toBe(false);
    expect(mocks.confirmEvidenceAnswers).not.toHaveBeenCalled();
  });
});

describe('confirmAnswersAction: the input is bounded', () => {
  it('asks the person to choose something when no usable answer was posted', async () => {
    const result = await confirmAnswersAction(PREV, form([]));
    expect(result).toEqual({
      ok: false,
      message: 'Choose at least one answer to send.',
      sent: 0,
      changed: 0,
    });
    expect(mocks.getApplicant).not.toHaveBeenCalled();
  });

  it('ignores malformed values, an empty part, a long part and a repeated request', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 2 }));
    await confirmAnswersAction(
      PREV,
      form([
        A1,
        'only-one-part',
        'a|b',
        'a|b|c|d',
        '||',
        `r9|d9|${'x'.repeat(65)}`,
        'r1|dX|vX',
        ` ${A2} `,
      ]),
    );
    const input = mocks.confirmEvidenceAnswers.mock.calls[0]?.[1] as {
      answers: { requestId: string }[];
    };
    expect(input.answers.map((answer) => answer.requestId)).toEqual(['r1', 'r2']);
  });

  it('reads at most 25 answers, however many are posted', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 25 }));
    const many = Array.from({ length: 40 }, (_unused, n) => `r${n}|d${n}|v${n}`);
    await confirmAnswersAction(PREV, form(many));
    const input = mocks.confirmEvidenceAnswers.mock.calls[0]?.[1] as { answers: unknown[] };
    expect(input.answers).toHaveLength(25);
  });

  it('says the page is out of date when the agency, key or traveller is missing', async () => {
    for (const missing of ['applicantId', 'organizationId', 'confirmationKey']) {
      const result = await confirmAnswersAction(PREV, form([A1], { [missing]: '' }));
      expect(result.message).toBe('This page is out of date. Refresh it and choose again.');
    }
    expect(mocks.confirmEvidenceAnswers).not.toHaveBeenCalled();
  });
});
