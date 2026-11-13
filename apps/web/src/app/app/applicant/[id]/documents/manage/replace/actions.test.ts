import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listReplacementOptions: vi.fn(),
  replaceDocument: vi.fn(),
  readImpact: vi.fn(),
}));
vi.mock('../../../../../../../lib/change-impact-read', () => ({
  readDocumentChangeImpact: mocks.readImpact,
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  listReplacementOptions: mocks.listReplacementOptions,
  replaceDocument: mocks.replaceDocument,
  REPLACE_REFUSALS: {
    notOwner: 'only the record owner can replace a document',
    sameDocument: 'a document cannot replace itself',
    alreadyReplaced: 'this document has already been replaced',
    newerReplaced: 'the newer document has itself been replaced',
    checking: 'the newer document is still being checked',
    cannotUse: 'the newer document cannot be used',
    expired: 'the newer document has expired',
    notCurrent: 'only a current document can be replaced, with another current document',
    otherKind: 'the newer document must be the same kind of document',
  },
}));
vi.mock('../../../../../../../lib/session', () => ({
  withSession: (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('../../../../../../../lib/upload-preflight', () => ({ pdfUploadsAccepted: () => false }));

import { previewReplaceImpactAction, replaceDocumentAction, replaceOptionsAction } from './actions';

const proof = (applicantId: string) => ({ ok: true, value: { applicant: { id: applicantId } } });

/** A stand-in for a review: the actions hand it on untouched. */
const REVIEW = { phase: 'RECORDED', items: [], quiet: true };

beforeEach(() => {
  mocks.readImpact.mockResolvedValue('failed');
});
afterEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('what the replacement affects', () => {
  const replaced = { ok: true, value: { flaggedMissionIds: [], cases: [] } };

  it('is read for the old document only after the replacement is saved', async () => {
    mocks.requireAccess.mockResolvedValue(proof('a1'));
    mocks.replaceDocument.mockResolvedValue(replaced);
    mocks.readImpact.mockResolvedValue(REVIEW);
    expect(await replaceDocumentAction('a1', 'old', 'new')).toEqual({
      ok: true,
      message: 'Replaced. The old document stays in your records, marked Replaced.',
      impact: REVIEW,
    });
    // The recorded review names no candidate: the saved replacement is what it reads.
    expect(mocks.readImpact.mock.calls).toEqual([['a1', 'old']]);
    expect(mocks.replaceDocument.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readImpact.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('never turns a finished replacement into a failure when the read fails or is refused', async () => {
    mocks.requireAccess.mockResolvedValue(proof('a1'));
    mocks.replaceDocument.mockResolvedValue(replaced);
    for (const read of ['failed', 'refused']) {
      mocks.readImpact.mockResolvedValue(read);
      expect(await replaceDocumentAction('a1', 'old', 'new')).toEqual({
        ok: true,
        message: 'Replaced. The old document stays in your records, marked Replaced.',
        impact: null,
      });
    }
  });

  it('is not read at all when the replacement was refused', async () => {
    mocks.requireAccess.mockResolvedValue(proof('a1'));
    mocks.replaceDocument.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'the newer document has expired' },
    });
    expect(await replaceDocumentAction('a1', 'old', 'new')).toEqual({
      ok: false,
      message: 'The newer document has expired. Choose one that is still valid.',
    });
    expect(mocks.readImpact).not.toHaveBeenCalled();
  });

  it('is previewed for the chosen newer document, and changes nothing', async () => {
    mocks.readImpact.mockResolvedValue({ ...REVIEW, phase: 'PREVIEW' });
    expect(await previewReplaceImpactAction('a1', 'old', 'new')).toEqual({
      ...REVIEW,
      phase: 'PREVIEW',
    });
    expect(mocks.readImpact.mock.calls).toEqual([['a1', 'old', 'new']]);
    expect(mocks.replaceDocument).not.toHaveBeenCalled();
    for (const read of ['failed', 'refused']) {
      mocks.readImpact.mockResolvedValue(read);
      expect(await previewReplaceImpactAction('a1', 'old', 'new')).toBeNull();
    }
  });
});

describe('replace actions', () => {
  it('ask for the owner MANAGE proof on the old document, never trusting the page', async () => {
    mocks.requireAccess.mockResolvedValue(proof('someone-else'));
    expect(await replaceDocumentAction('a1', 'old', 'new')).toEqual({
      ok: false,
      message: 'You can replace only your own documents.',
    });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct-1' },
      'MANAGE',
      { documentId: 'old' },
      { purpose: 'owner_document_replace' },
    );
    expect(mocks.replaceDocument).not.toHaveBeenCalled();
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect((await replaceOptionsAction('a1', 'old')).ok).toBe(false);
    expect(mocks.listReplacementOptions).not.toHaveBeenCalled();
  });

  it('replace and return the result line, leaving the redraw to the flow', async () => {
    mocks.requireAccess.mockResolvedValue(proof('a1'));
    mocks.replaceDocument.mockResolvedValue({
      ok: true,
      value: { flaggedMissionIds: ['m1'], cases: [{ missionId: 'm1', title: 'Japan Visit' }] },
    });
    const result = await replaceDocumentAction('a1', 'old', 'new');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('1 case was updated');
  });

  it('turn a refusal into plain words', async () => {
    mocks.requireAccess.mockResolvedValue(proof('a1'));
    mocks.replaceDocument.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'the newer document is still being checked',
      },
    });
    expect((await replaceDocumentAction('a1', 'old', 'new')).message).toBe(
      'The newer document is still being checked. Try again in a moment.',
    );
    mocks.replaceDocument.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'the newer document has expired' },
    });
    expect((await replaceDocumentAction('a1', 'old', 'new')).message).toBe(
      'The newer document has expired. Choose one that is still valid.',
    );
    mocks.replaceDocument.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'something unexpected' },
    });
    expect((await replaceDocumentAction('a1', 'old', 'new')).message).toBe(
      'This document cannot be replaced right now. Refresh the page and try again.',
    );
  });

  it('list the options with readable kinds and dates', async () => {
    mocks.requireAccess.mockResolvedValue(proof('a1'));
    mocks.listReplacementOptions.mockResolvedValue({
      ok: true,
      value: {
        docType: 'PASSPORT',
        candidates: [
          {
            documentId: 'n',
            name: 'Passport, New',
            uploadedAt: new Date('2026-10-30T00:00:00Z'),
            status: 'READY',
          },
        ],
        cases: [],
      },
    });
    const result = await replaceOptionsAction('a1', 'old');
    expect(result).toEqual({
      ok: true,
      docType: 'PASSPORT',
      kindLabel: 'Passport',
      candidates: [
        {
          documentId: 'n',
          name: 'Passport, New',
          uploadedAt: '2026-10-30T00:00:00.000Z',
          status: 'READY',
        },
      ],
      cases: [],
      pdfAccepted: false,
    });
  });
});
