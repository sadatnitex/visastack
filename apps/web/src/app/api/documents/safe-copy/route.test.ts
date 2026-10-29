import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { session, requireAccess, produce, stepUp, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  session: vi.fn(),
  requireAccess: vi.fn(),
  produce: vi.fn(),
  stepUp: vi.fn(),
}));
vi.mock('../../../../lib/session', () => ({ withSession: session }));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({ getObject: vi.fn() }) }));
vi.mock('../../../../lib/step-up', () => ({ establishStepUpProof: stepUp }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('@visastack/adapters', () => ({ createSafeCopyRenderer: () => ({}) }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: EACH,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess,
  produceSafeCopy: produce,
}));

const documentId = '00000000-0000-4000-8000-000000000001';
const orgId = '00000000-0000-4000-8000-0000000000aa';
const PDF = new Uint8Array(600 * 1024).fill(0x25);

function request(body: unknown, origin = 'https://app.example') {
  const text = JSON.stringify(body);
  return new Request('https://app.example/api/documents/safe-copy', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(text)),
    },
    body: text,
  });
}

const valid = { documentId, returnTo: '/app/shared/grant-1' };

beforeEach(() => {
  session.mockReset();
  requireAccess.mockReset();
  produce.mockReset();
  stepUp.mockReset();
  session.mockImplementation((fn) => fn({ db: {}, accountId: 'acct' }));
  requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
  produce.mockResolvedValue({
    ok: true,
    value: { bytes: PDF, contentType: 'application/pdf', pageCount: 2, filename: 'safe-copy.pdf' },
  });
});

describe('safe copy download route', () => {
  it('streams the safe copy as an attachment with the document download headers', async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="safe-copy\.pdf"/,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('content-length')).toBe(String(PDF.byteLength));
    // A stream, read in pieces, that adds up to exactly the copy.
    expect(response.body).toBeInstanceOf(ReadableStream);
    const reader = response.body?.getReader();
    let total = 0;
    let pieces = 0;
    for (;;) {
      const next = await reader?.read();
      if (!next || next.done) break;
      total += next.value.byteLength;
      pieces += 1;
    }
    expect(total).toBe(PDF.byteLength);
    expect(pieces).toBeGreaterThan(1);
  });

  it('asks the central gate for Download Safe Copies on that one document, judged per grant', async () => {
    await POST(request({ ...valid, actingFor: orgId }));
    expect(requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct' },
      'DOWNLOAD_REDACTED',
      { documentId },
      { purpose: EACH, actingFor: { organizationId: orgId } },
    );
    expect(produce).toHaveBeenCalledWith({ proof: true }, expect.anything());
  });

  it('says plainly when the copy is not prepared, too large or not possible, and serves nothing', async () => {
    const cases = [
      ['not_prepared', 409, 'This safe copy is not prepared yet.'],
      ['too_large', 413, 'This document is too large for a safe copy.'],
      ['unsupported', 415, 'Safe copies can be made from PDF files and photos only.'],
      ['unreadable', 422, 'This file could not be read for a safe copy.'],
      ['not_available', 403, 'This document is not available to you'],
    ] as const;
    for (const [refusal, status, words] of cases) {
      produce.mockResolvedValueOnce({
        ok: false,
        error: { code: 'invalid', message: 'internal reason', refusal },
      });
      const response = await POST(request(valid));
      expect(response.status).toBe(status);
      expect(response.headers.get('content-type')).toContain('application/json');
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain(words);
      expect(body.message).not.toContain('internal reason');
    }
    produce.mockResolvedValueOnce({ ok: false, error: { code: 'rate_limited', message: 'x' } });
    expect((await POST(request(valid))).status).toBe(429);
  });

  it('answers a missing document exactly like a refused one, so ids cannot be probed', async () => {
    requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'not_found', message: 'x' } });
    const missing = await POST(request(valid));
    requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden', message: 'y' } });
    const refused = await POST(request(valid));
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual(await refused.json());
    expect(produce).not.toHaveBeenCalled();
  });

  it('asks for a fresh identity check on a restricted document before making anything', async () => {
    requireAccess.mockResolvedValueOnce({
      ok: false,
      error: { code: 'step_up_required', message: 'reauth' },
    });
    stepUp.mockResolvedValueOnce({ kind: 'reauth_required', reauthUrl: '/auth/reauth?returnTo=x' });
    const stale = await POST(request(valid));
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ reauthUrl: '/auth/reauth?returnTo=x' });
    expect(stepUp).toHaveBeenCalledWith(
      { accountId: 'acct', action: 'DOWNLOAD_REDACTED', resourceId: documentId },
      valid.returnTo,
    );
    expect(produce).not.toHaveBeenCalled();
  });

  it('refuses another origin, a bad id or an unknown relationship before any session work', async () => {
    expect((await POST(request(valid, 'https://evil.example'))).status).toBe(403);
    expect((await POST(request({ ...valid, documentId: '../etc' }))).status).toBe(400);
    expect((await POST(request({ ...valid, actingFor: 'someone' }))).status).toBe(400);
    expect((await POST(request({ ...valid, padding: 'x'.repeat(5000) }))).status).toBe(400);
    expect(session).not.toHaveBeenCalled();
  });
});
