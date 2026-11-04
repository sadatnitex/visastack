import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  copyDocumentToPerson: vi.fn(),
  revalidatePath: vi.fn(),
  after: vi.fn(),
}));

vi.mock('@visastack/services', () => ({
  accountPrincipal: (id: string) => ({ accountId: id }),
  requireAccess: mocks.requireAccess,
  copyDocumentToPerson: mocks.copyDocumentToPerson,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../../../../../../../lib/session', () => ({
  withSession: async (run: (context: unknown) => Promise<unknown>) =>
    run({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('../../../../../../../lib/storage', () => ({ createStorage: () => ({ stored: true }) }));
vi.mock('../../../../../../api/jobs/process-ai-reading/run', () => ({
  triggerIntakeAndReading: vi.fn(),
}));

const { keepCopyAction } = await import('./actions');

const A = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const NONE = { ok: false, message: '' };
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const good = { applicantId: A, documentId: DOC, targetId: B };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockImplementation(
    async (
      _db: unknown,
      _who: unknown,
      _action: string,
      scope: { documentId?: string; applicantId?: string },
    ) =>
      scope.documentId
        ? { ok: true, value: { applicant: { id: A, displayName: 'Nazmus Sadat' } } }
        : { ok: true, value: { applicant: { id: scope.applicantId, displayName: 'Salma Sadat' } } },
  );
  mocks.copyDocumentToPerson.mockResolvedValue({
    ok: true,
    value: { documentId: 'new', title: 'T' },
  });
});

describe('keepCopyAction', () => {
  it('keeps the copy through two separate owner proofs, queues the check, and names the person', async () => {
    const result = await keepCopyAction(NONE, form(good));
    expect(result).toEqual({
      ok: true,
      message: 'A copy is kept for Salma Sadat. It is checked for safety first, like any new file.',
      targetId: B,
    });
    // One proof for the document's own person, one for the person receiving the copy.
    expect(mocks.requireAccess.mock.calls.map((call) => [call[2], call[3], call[4]])).toEqual([
      ['MANAGE', { documentId: DOC }, { purpose: 'owner_document_copy' }],
      ['MANAGE', { applicantId: B }, { purpose: 'owner_document_copy' }],
    ]);
    expect(mocks.copyDocumentToPerson).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/applicant/${A}/documents`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/applicant/${B}/documents`);
  });

  it('asks nothing of the service when an id is not a record id', async () => {
    for (const bad of [
      { ...good, targetId: 'someone' },
      { ...good, documentId: '' },
      { ...good, applicantId: '../x' },
    ]) {
      expect(await keepCopyAction(NONE, form(bad))).toEqual({
        ok: false,
        message: 'This document is not available to copy right now.',
      });
    }
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it("answers one plain line when either record is not the account's own, or the page is for another person", async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    expect((await keepCopyAction(NONE, form(good))).message).toBe(
      'This document is not available to copy right now.',
    );
    mocks.requireAccess.mockReset();
    mocks.requireAccess
      .mockResolvedValueOnce({ ok: true, value: { applicant: { id: A } } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    expect((await keepCopyAction(NONE, form(good))).message).toBe(
      'This document is not available to copy right now.',
    );
    mocks.requireAccess.mockReset();
    mocks.requireAccess.mockResolvedValue({ ok: true, value: { applicant: { id: B } } });
    // The document belongs to person B but the page said person A: refused, nothing copied.
    expect((await keepCopyAction(NONE, form(good))).ok).toBe(false);
    expect(mocks.copyDocumentToPerson).not.toHaveBeenCalled();
  });

  it("shows the service's plain refusal, and a fixed line for anything else", async () => {
    mocks.copyDocumentToPerson.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', message: 'Salma Sadat already has this document.' },
    });
    expect(await keepCopyAction(NONE, form(good))).toEqual({
      ok: false,
      message: 'Salma Sadat already has this document.',
    });
    mocks.copyDocumentToPerson.mockResolvedValueOnce({
      ok: false,
      error: { code: 'step_up_required', message: 'internal text that must not show' },
    });
    expect((await keepCopyAction(NONE, form(good))).message).toBe(
      'This document is not available to copy right now.',
    );
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('answers a thrown failure with a line a person can act on', async () => {
    mocks.copyDocumentToPerson.mockRejectedValueOnce(new Error('connection reset'));
    expect(await keepCopyAction(NONE, form(good))).toEqual({
      ok: false,
      message: 'That did not go through. Check your connection and try again.',
    });
  });
});
