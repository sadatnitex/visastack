import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { session, requireAccess, prepare, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  session: vi.fn(),
  requireAccess: vi.fn(),
  prepare: vi.fn(),
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
  prepareSafeCopyPage: prepare,
}));

const documentId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000101';
const maskRevision = '00000000-0000-4000-8000-0000000000ee';

function request(body: unknown) {
  const text = JSON.stringify(body);
  return new Request('https://app.example/api/documents/safe-copy-prepare', {
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
  for (const mock of [session, requireAccess, prepare]) mock.mockReset();
  session.mockImplementation((fn) => fn({ db: {}, accountId: 'acct' }));
  requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
  prepare.mockResolvedValue({
    ok: true,
    value: { page: 2, pageCount: 3, preparedPages: 2, state: 'PREPARING' },
  });
});

describe('safe copy preparing route', () => {
  it('prepares one page through a MANAGE proof and reports progress', async () => {
    const response = await POST(request({ documentId, versionId, page: 2, maskRevision }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      page: 2,
      pageCount: 3,
      preparedPages: 2,
      state: 'PREPARING',
    });
    expect(requireAccess.mock.calls[0]?.[2]).toBe('MANAGE');
    expect(prepare).toHaveBeenCalledWith({ proof: true }, expect.anything(), {
      versionId,
      page: 2,
      maskRevision,
    });
  });

  it('needs a version, a page and a revision, and refuses plainly when out of date', async () => {
    for (const body of [
      { documentId, versionId, page: 1 },
      { documentId, page: 1, maskRevision },
      { documentId, versionId, maskRevision },
      { documentId, versionId, page: 1, maskRevision: 'old' },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(session).not.toHaveBeenCalled();
    prepare.mockResolvedValueOnce({
      ok: false,
      error: { code: 'stale', message: 'x', refusal: 'out_of_date' },
    });
    const stale = await POST(request({ documentId, versionId, page: 1, maskRevision }));
    expect(stale.status).toBe(409);
  });

  it('refuses while safe copies are off here', async () => {
    capability.redactedDownload = 'disabled';
    expect((await POST(request({ documentId, versionId, page: 1, maskRevision }))).status).toBe(
      503,
    );
    expect(prepare).not.toHaveBeenCalled();
  });
});
