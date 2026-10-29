import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { session, requireAccess, render, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  session: vi.fn(),
  requireAccess: vi.fn(),
  render: vi.fn(),
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
  renderRedactionPage: render,
}));

const documentId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000101';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function request(body: unknown) {
  const text = JSON.stringify(body);
  return new Request('https://app.example/api/documents/redaction-page', {
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
  for (const mock of [session, requireAccess, render]) mock.mockReset();
  session.mockImplementation((fn) => fn({ db: {}, accountId: 'acct' }));
  requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
  render.mockResolvedValue({
    ok: true,
    value: { bytes: JPEG, contentType: 'image/jpeg', width: 1240, height: 1754 },
  });
});

describe('safe copy editor page route', () => {
  it('serves one page inline as a JPEG through a PREVIEW proof, never cached', async () => {
    const response = await POST(request({ documentId, versionId, page: 2 }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-disposition')).toMatch(/^inline/);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(requireAccess.mock.calls[0]?.[2]).toBe('PREVIEW');
    expect(render).toHaveBeenCalledWith({ proof: true }, expect.anything(), { versionId, page: 2 });
  });

  it('needs a version and a page from 1 to 20, and passes refusals on plainly', async () => {
    expect((await POST(request({ documentId, versionId }))).status).toBe(400);
    expect((await POST(request({ documentId, page: 1 }))).status).toBe(400);
    expect((await POST(request({ documentId, versionId, page: 0 }))).status).toBe(400);
    expect(session).not.toHaveBeenCalled();
    render.mockResolvedValueOnce({
      ok: false,
      error: { code: 'stale', message: 'x', refusal: 'out_of_date' },
    });
    const stale = await POST(request({ documentId, versionId, page: 1 }));
    expect(stale.status).toBe(409);
  });
});
