import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { session, requireAccess, check, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  session: vi.fn(),
  requireAccess: vi.fn(),
  check: vi.fn(),
}));
vi.mock('../../../../lib/session', () => ({ withSession: session }));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({ getObject: vi.fn() }) }));
vi.mock('../../../../lib/step-up', () => ({ establishStepUpProof: vi.fn() }));
vi.mock('@visastack/adapters', () => ({ createPhotoSizer: () => ({}) }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: EACH,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess,
  checkVisaPhoto: check,
}));

const documentId = '00000000-0000-4000-8000-000000000001';

function request(body: unknown, origin = 'https://app.example') {
  const text = JSON.stringify(body);
  return new Request('https://app.example/api/documents/photo-check', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(text)),
    },
    body: text,
  });
}

beforeEach(() => {
  session.mockReset();
  requireAccess.mockReset();
  check.mockReset();
  session.mockImplementation((fn) => fn({ db: {}, accountId: 'acct' }));
  requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
  check.mockResolvedValue({
    ok: true,
    value: {
      sourceWidth: 1200,
      sourceHeight: 1500,
      findings: [{ id: 'too_dark', title: 'Too dark', detail: 'Use more light.' }],
      preview: { bytes: new Uint8Array([1, 2, 3]), width: 384, height: 480 },
    },
  });
});

describe('visa photo check route', () => {
  it('needs the safe-copy permission, not mere preview, and returns findings and a small preview, never cached', async () => {
    const response = await POST(request({ documentId, actingFor: 'individual' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      sourceWidth: 1200,
      sourceHeight: 1500,
      findings: [{ id: 'too_dark', title: 'Too dark', detail: 'Use more light.' }],
      preview: { width: 384, height: 480, jpegBase64: 'AQID' },
    });
    expect(requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct' },
      'DOWNLOAD_REDACTED',
      { documentId },
      { purpose: EACH, actingFor: 'individual' },
    );
  });

  it('refuses another origin before any session work', async () => {
    expect((await POST(request({ documentId }, 'https://evil.example'))).status).toBe(403);
    expect(session).not.toHaveBeenCalled();
  });

  it('refuses when the gate refuses, without checking the photo', async () => {
    requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden', message: 'x' } });
    expect((await POST(request({ documentId }))).status).toBe(403);
    expect(check).not.toHaveBeenCalled();
  });
});
