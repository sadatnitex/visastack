import { err, ok } from '@visastack/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  archiveDocument: vi.fn(),
  restoreDocument: vi.fn(),
  session: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  archiveDocument: mocks.archiveDocument,
  restoreDocument: mocks.restoreDocument,
}));
vi.mock('../../../../../../../lib/session', () => ({ withSession: mocks.session }));
const { archiveDocumentAction, restoreDocumentAction } = await import('./actions');

const proof = { applicant: { id: 'applicant-1' } };
const UNAVAILABLE = 'This document is not available to archive or restore right now.';

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.session.mockImplementation(async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: 'db', accountId: 'owner' }),
  );
  mocks.requireAccess.mockResolvedValue(ok(proof));
});

describe('LC-A1 archive server actions', () => {
  it('asks the gate for the owner MANAGE proof on that one document, then archives', async () => {
    mocks.archiveDocument.mockResolvedValue(ok({ state: 'ARCHIVED', changed: true }));
    expect(await archiveDocumentAction('applicant-1', 'doc-1')).toEqual({
      ok: true,
      changed: true,
    });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      'db',
      { kind: 'account', accountId: 'owner' },
      'MANAGE',
      { documentId: 'doc-1' },
      { purpose: 'owner_document_archive' },
    );
    expect(mocks.archiveDocument).toHaveBeenCalledWith('doc-1', proof);
    expect(mocks.restoreDocument).not.toHaveBeenCalled();
  });

  it('restores through the same gate', async () => {
    mocks.restoreDocument.mockResolvedValue(ok({ state: 'CURRENT', changed: false }));
    expect(await restoreDocumentAction('applicant-1', 'doc-1')).toEqual({
      ok: true,
      changed: false,
    });
    expect(mocks.requireAccess.mock.calls[0]?.[4]).toEqual({ purpose: 'owner_document_restore' });
    expect(mocks.restoreDocument).toHaveBeenCalledWith('doc-1', proof);
  });

  it('gives one answer for a refused gate, a document of another record and a refused change', async () => {
    mocks.requireAccess.mockResolvedValueOnce(err({ code: 'forbidden', message: 'x' }));
    expect(await archiveDocumentAction('applicant-1', 'doc-1')).toEqual({
      ok: false,
      message: UNAVAILABLE,
    });
    expect(await archiveDocumentAction('applicant-2', 'doc-1')).toEqual({
      ok: false,
      message: UNAVAILABLE,
    });
    mocks.archiveDocument.mockResolvedValueOnce(err({ code: 'not_found', message: 'x' }));
    expect(await archiveDocumentAction('applicant-1', 'doc-1')).toEqual({
      ok: false,
      message: UNAVAILABLE,
    });
    expect(mocks.archiveDocument).toHaveBeenCalledTimes(1);
  });

  it('points a document in Recently Deleted to its own list', async () => {
    mocks.restoreDocument.mockResolvedValue(err({ code: 'invalid', message: 'x' }));
    expect(await restoreDocumentAction('applicant-1', 'doc-1')).toEqual({
      ok: false,
      message: 'This document is in Recently Deleted. Restore it from there first.',
    });
  });

  it('refuses arguments that are not text without asking the gate', async () => {
    expect(await archiveDocumentAction(42 as never, 'doc-1')).toEqual({
      ok: false,
      message: UNAVAILABLE,
    });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('lets a sign-in redirect through and turns any other failure into a try-again answer', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/signin;307;',
    });
    mocks.session.mockRejectedValueOnce(redirect);
    await expect(archiveDocumentAction('applicant-1', 'doc-1')).rejects.toBe(redirect);
    mocks.session.mockRejectedValueOnce(new Error('connection lost'));
    expect(await archiveDocumentAction('applicant-1', 'doc-1')).toEqual({
      ok: false,
      message: 'That did not go through. Check your connection and try again.',
    });
  });
});
