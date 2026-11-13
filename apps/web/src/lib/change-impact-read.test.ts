import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The seam every What This Change Affects screen reads through: one pass through the central
 * gate as the signed-in person, then the service. A refusal, a missing record and an impossible
 * request all come back as the same word; anything that breaks comes back as "failed", never as
 * a thrown error, so a save or a replacement that already succeeded is not undone by it.
 */

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  assessDocument: vi.fn(),
  assessDetail: vi.fn(),
  withSession: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  assessDocumentChangeImpact: mocks.assessDocument,
  assessDetailChangeImpact: mocks.assessDetail,
}));
vi.mock('./session', () => ({ withSession: mocks.withSession }));
vi.mock('next/navigation', () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && /^NEXT_/.test(error.message)) throw error;
  },
}));

import {
  CHANGE_IMPACT_READ_BUDGET_MS,
  readDetailChangeImpact,
  readDocumentChangeImpact,
} from './change-impact-read';

const PROOF = { applicant: { id: 'a1' }, proof: true };
const REVIEW = { phase: 'RECORDED', items: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.withSession.mockImplementation((fn: (ctx: object) => unknown) =>
    fn({ db: { db: true }, accountId: 'acct-1' }),
  );
  mocks.requireAccess.mockResolvedValue({ ok: true, value: PROOF });
  mocks.assessDocument.mockResolvedValue({ ok: true, value: REVIEW });
  mocks.assessDetail.mockResolvedValue({ ok: true, value: REVIEW });
});

describe('reading what a change affects', () => {
  it('asks the central gate for the owner proof on the traveller, never trusting the address', async () => {
    expect(await readDetailChangeImpact('a1', 'f1')).toBe(REVIEW);
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      { db: true },
      { kind: 'account', accountId: 'acct-1' },
      'MANAGE',
      { applicantId: 'a1' },
      { purpose: 'change_impact' },
    );
    expect(mocks.assessDetail).toHaveBeenCalledWith(PROOF, { factId: 'f1' });
  });

  it('names the candidate only for a preview', async () => {
    expect(await readDocumentChangeImpact('a1', 'd1')).toBe(REVIEW);
    expect(mocks.assessDocument).toHaveBeenLastCalledWith(PROOF, { documentId: 'd1' });
    await readDocumentChangeImpact('a1', 'd1', 'd2');
    expect(mocks.assessDocument).toHaveBeenLastCalledWith(PROOF, {
      documentId: 'd1',
      replacementDocumentId: 'd2',
    });
  });

  it('does not reach the service when the gate refuses, and says only "refused"', async () => {
    for (const code of ['not_found', 'forbidden']) {
      mocks.requireAccess.mockResolvedValue({ ok: false, error: { code, message: 'x' } });
      expect(await readDocumentChangeImpact('a1', 'd1')).toBe('refused');
      expect(await readDetailChangeImpact('a1', 'f1')).toBe('refused');
    }
    expect(mocks.assessDocument).not.toHaveBeenCalled();
    expect(mocks.assessDetail).not.toHaveBeenCalled();
  });

  it('treats the service refusal and an impossible request alike', async () => {
    for (const code of ['not_found', 'invalid']) {
      mocks.assessDocument.mockResolvedValue({ ok: false, error: { code, message: 'x' } });
      expect(await readDocumentChangeImpact('a1', 'd1', 'd1')).toBe('refused');
    }
  });

  it('says "failed" for a broken read, whether it is reported or thrown', async () => {
    mocks.assessDetail.mockResolvedValue({
      ok: false,
      error: { code: 'upstream_error', message: 'x' },
    });
    expect(await readDetailChangeImpact('a1', 'f1')).toBe('failed');
    mocks.assessDetail.mockRejectedValue(new Error('connection lost'));
    expect(await readDetailChangeImpact('a1', 'f1')).toBe('failed');
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'upstream_error' } });
    expect(await readDocumentChangeImpact('a1', 'd1')).toBe('failed');
    mocks.withSession.mockRejectedValue(new Error('database not configured'));
    expect(await readDocumentChangeImpact('a1', 'd1')).toBe('failed');
  });

  it('lets a sign-in redirect travel on', async () => {
    mocks.withSession.mockRejectedValue(new Error('NEXT_REDIRECT:/auth/sign-in'));
    await expect(readDetailChangeImpact('a1', 'f1')).rejects.toThrow('NEXT_REDIRECT');
  });

  it('says "failed" when a look is slower than its budget, so a committed save is never held up', async () => {
    vi.useFakeTimers();
    try {
      mocks.assessDetail.mockReturnValue(new Promise(() => undefined));
      const pending = readDetailChangeImpact('a1', 'f1');
      await vi.advanceTimersByTimeAsync(CHANGE_IMPACT_READ_BUDGET_MS - 1);
      let settled = false;
      pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await pending).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not leave a timer behind when the look finishes in time', async () => {
    vi.useFakeTimers();
    try {
      expect(await readDetailChangeImpact('a1', 'f1')).toBe(REVIEW);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
