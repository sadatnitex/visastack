import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submitEvidenceResponse: vi.fn(),
  askAboutRequestItem: vi.fn(),
  requireAccess: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  submitEvidenceResponse: mocks.submitEvidenceResponse,
  askAboutRequestItem: mocks.askAboutRequestItem,
  requireAccess: mocks.requireAccess,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'owner' }),
}));

const { askAboutRequestItemAction, submitEvidenceResponseAction } = await import('./actions');

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const PREV = { ok: true, message: '' };
const RESPONDED = new Date('2026-10-27T08:32:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('submitEvidenceResponseAction: the time it reports is the server time', () => {
  it('returns the moment the answer was recorded, and refreshes the page', async () => {
    mocks.submitEvidenceResponse.mockResolvedValue({
      ok: true,
      value: { respondedAt: RESPONDED, updatedAt: new Date('2026-10-27T08:33:00.000Z') },
    });
    const result = await submitEvidenceResponseAction(
      PREV,
      form({ applicantId: 'a1', requestId: 'r1', factId: 'f1' }),
    );
    expect(result).toEqual({
      ok: true,
      message: 'The agency will review it.',
      savedAt: '2026-10-27T08:32:00.000Z',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/a1/evidence');
  });

  it('returns no time and does not refresh when the service refuses', async () => {
    mocks.submitEvidenceResponse.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'this request is not awaiting a submission' },
    });
    const result = await submitEvidenceResponseAction(
      PREV,
      form({ applicantId: 'a1', requestId: 'r1', documentId: 'd1' }),
    );
    expect(result).toEqual({
      ok: false,
      message:
        'This request is no longer waiting for you. Refresh the page to see where it stands.',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('says a file that is not ready in plain words, and passes any other reason on as written', async () => {
    mocks.submitEvidenceResponse.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message:
          'this document has not finished safety processing, or failed it, and cannot be submitted yet',
      },
    });
    const form1 = form({ applicantId: 'a1', requestId: 'r1', documentId: 'd1' });
    expect((await submitEvidenceResponseAction(PREV, form1)).message).toBe(
      'That file has not finished its safety checks, or could not be used. Choose another file, or wait a moment.',
    );
    mocks.submitEvidenceResponse.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'Something else.' },
    });
    expect((await submitEvidenceResponseAction(PREV, form1)).message).toBe('Something else.');
  });

  it('asks the person to choose before it calls the service at all', async () => {
    const result = await submitEvidenceResponseAction(PREV, form({ requestId: 'r1' }));
    expect(result).toEqual({ ok: false, message: 'Choose what to submit.' });
    expect(mocks.submitEvidenceResponse).not.toHaveBeenCalled();
  });
});

describe('askAboutRequestItemAction', () => {
  const asked = form({
    applicantId: 'a1',
    missionId: 'm1',
    requestId: 'r1',
    question: 'Which month?',
  });

  it('checks access as a comment on the request case, then reports the note time', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: true, value: { applicant: { id: 'a1' } } });
    mocks.askAboutRequestItem.mockResolvedValue({
      ok: true,
      value: { createdAt: RESPONDED },
    });
    const result = await askAboutRequestItemAction(PREV, asked);
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      { tag: 'db' },
      { kind: 'account', accountId: 'owner' },
      'COMMENT',
      { missionId: 'm1' },
      { purpose: 'owner_request_question' },
    );
    expect(mocks.askAboutRequestItem).toHaveBeenCalledWith(
      { applicant: { id: 'a1' } },
      { requestId: 'r1', question: 'Which month?' },
    );
    expect(result).toEqual({
      ok: true,
      message: 'The agency can read it in the case notes.',
      savedAt: '2026-10-27T08:32:00.000Z',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/a1/evidence');
  });

  it('sends nothing when the case belongs to another person than the page says', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { applicant: { id: 'someone-else' } },
    });
    const result = await askAboutRequestItemAction(PREV, asked);
    expect(result).toEqual({ ok: false, message: 'This question could not be sent.' });
    expect(mocks.askAboutRequestItem).not.toHaveBeenCalled();
  });

  it('sends nothing when access is refused, and says so without naming why', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await askAboutRequestItemAction(PREV, asked);
    expect(result).toEqual({ ok: false, message: 'This question could not be sent.' });
    expect(mocks.askAboutRequestItem).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes on the service's plain reason when the question is refused", async () => {
    mocks.requireAccess.mockResolvedValue({ ok: true, value: { applicant: { id: 'a1' } } });
    mocks.askAboutRequestItem.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'Write your question first.' },
    });
    const result = await askAboutRequestItemAction(PREV, asked);
    expect(result).toEqual({ ok: false, message: 'Write your question first.' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('needs all three ids', async () => {
    const result = await askAboutRequestItemAction(
      PREV,
      form({ applicantId: 'a1', question: 'x' }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });
});
