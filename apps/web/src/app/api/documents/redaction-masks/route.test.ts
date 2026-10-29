import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { session, requireAccess, save, clear, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  session: vi.fn(),
  requireAccess: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}));
const capability = vi.hoisted(() => ({ redactedDownload: 'available' }));
vi.mock('../../../../lib/capabilities', () => ({ getPlatformCapabilities: () => capability }));
vi.mock('../../../../lib/session', () => ({ withSession: session }));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../../../lib/step-up', () => ({ establishStepUpProof: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('@visastack/adapters', () => ({ createSafeCopyRenderer: () => ({}) }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: EACH,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess,
  saveRedactionMasks: save,
  clearRedactionMasks: clear,
}));

const documentId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000101';
const BOX = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

function request(body: unknown) {
  const text = JSON.stringify(body);
  return new Request('https://app.example/api/documents/redaction-masks', {
    method: 'POST',
    headers: {
      origin: 'https://app.example',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(text)),
    },
    body: text,
  });
}

beforeEach(() => {
  capability.redactedDownload = 'available';
  for (const mock of [session, requireAccess, save, clear]) mock.mockReset();
  session.mockImplementation((fn) => fn({ db: {}, accountId: 'acct' }));
  requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
  save.mockResolvedValue({
    ok: true,
    value: { versionId, pageCount: 2, boxCount: 1, state: 'PREPARING', maskRevision: versionId },
  });
  clear.mockResolvedValue({ ok: true, value: { pagesCleared: 2 } });
});

describe('safe copy boxes route', () => {
  it('saves through a MANAGE proof for that one document, passing every page on', async () => {
    const pages = [
      { boxes: [BOX], acceptedSuggestions: 1 },
      { boxes: [], acceptedSuggestions: 0 },
    ];
    const response = await POST(request({ documentId, versionId, pages, nothingToHide: false }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: 'PREPARING',
      pageCount: 2,
      boxCount: 1,
      maskRevision: versionId,
    });
    expect(requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct' },
      'MANAGE',
      { documentId },
      { purpose: EACH },
    );
    expect(save).toHaveBeenCalledWith({ proof: true }, expect.anything(), {
      versionId,
      pages,
      nothingToHide: false,
    });
  });

  it('clears through the same proof', async () => {
    const response = await POST(request({ documentId, versionId, clear: true }));
    expect(await response.json()).toEqual({ state: 'NOT_PREPARED' });
    expect(clear).toHaveBeenCalledWith({ proof: true }, { versionId }, expect.anything());
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses anyone the service refuses, in plain words', async () => {
    save.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden', message: 'owner only' } });
    const response = await POST(
      request({ documentId, versionId, pages: [{ boxes: [BOX] }], nothingToHide: false }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { message: string }).message).not.toContain('owner only');
    save.mockResolvedValueOnce({
      ok: false,
      error: { code: 'upstream_error', message: 'x', refusal: 'not_ready_yet' },
    });
    const notReady = await POST(
      request({ documentId, versionId, pages: [{ boxes: [BOX] }], nothingToHide: false }),
    );
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ message: 'Safe copies are not ready yet.' });
  });

  it('refuses a malformed save before any session work', async () => {
    for (const body of [
      { documentId, pages: [{ boxes: [BOX] }] },
      { documentId, versionId },
      { documentId, versionId, pages: 'all' },
      { documentId, versionId, pages: [{ boxes: 'none' }] },
      { documentId, versionId, pages: [{ boxes: [], acceptedSuggestions: 'one' }] },
      { documentId, versionId, pages: Array.from({ length: 21 }, () => ({ boxes: [] })) },
      { documentId, versionId, pages: [{ boxes: [] }], nothingToHide: 'yes' },
      { documentId, versionId, page: 21 },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    // A save bigger than 20 pages of 200 boxes could ever be is refused unread.
    const huge = { documentId, versionId, pages: [{ boxes: [], padding: 'x'.repeat(600_000) }] };
    expect((await POST(request(huge))).status).toBe(400);
    expect(session).not.toHaveBeenCalled();
  });
});
