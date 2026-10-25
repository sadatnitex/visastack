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
vi.mock('@visastack/adapters', () => ({ createPhotoSizer: () => ({}) }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: EACH,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess,
  produceVisaPhotoSize: produce,
}));

const documentId = '00000000-0000-4000-8000-000000000001';
const orgId = '00000000-0000-4000-8000-0000000000aa';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function request(body: unknown, origin = 'https://app.example', type = 'application/json') {
  return new Request('https://app.example/api/documents/photo-size', {
    method: 'POST',
    headers: { origin, 'content-type': type },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const valid = {
  documentId,
  specId: 'us-2x2',
  offsetX: 0.2,
  offsetY: -0.3,
  zoom: 1.4,
  returnTo: `/app/applicant/x/documents?document=${documentId}`,
};

beforeEach(() => {
  session.mockReset();
  requireAccess.mockReset();
  produce.mockReset();
  stepUp.mockReset();
  session.mockImplementation((fn) => fn({ db: {}, accountId: 'acct' }));
  requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
  produce.mockResolvedValue({
    ok: true,
    value: {
      spec: { id: 'us-2x2' },
      filename: 'visa-photo-us-2x2.jpg',
      photo: { bytes: JPEG, withinFileSizeRange: true },
    },
  });
});

describe('visa photo size download route', () => {
  it('serves the sized photo as an attachment with the document download headers', async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="visa-photo-us-2x2\.jpg"/,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('x-photo-size-within-limits')).toBe('yes');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
  });

  it('asks the central gate for the download permission on that one document, judged per grant', async () => {
    await POST(request({ ...valid, actingFor: orgId }));
    expect(requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct' },
      'DOWNLOAD_REDACTED',
      { documentId },
      { purpose: EACH, actingFor: { organizationId: orgId } },
    );
    expect(produce).toHaveBeenCalledWith({ proof: true }, expect.anything(), {
      specId: 'us-2x2',
      crop: { offsetX: 0.2, offsetY: -0.3, zoom: 1.4 },
    });
  });

  it('clamps an out-of-range crop and refuses one that is not a number', async () => {
    await POST(request({ ...valid, offsetX: -7, zoom: 40 }));
    expect(produce.mock.calls[0]?.[2]).toEqual({
      specId: 'us-2x2',
      crop: { offsetX: -1, offsetY: -0.3, zoom: 3 },
    });
    expect((await POST(request({ ...valid, zoom: 'big' }))).status).toBe(400);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('refuses another origin, a non-JSON body, a bad id or a missing size before any session work', async () => {
    expect((await POST(request(valid, 'https://evil.example'))).status).toBe(403);
    expect((await POST(request('documentId=x', 'https://app.example', 'text/plain'))).status).toBe(
      400,
    );
    expect((await POST(request({ ...valid, documentId: '../etc' }))).status).toBe(400);
    expect((await POST(request({ ...valid, specId: undefined }))).status).toBe(400);
    expect((await POST(request({ ...valid, actingFor: 'someone' }))).status).toBe(400);
    expect(session).not.toHaveBeenCalled();
  });

  it('says plainly when access is refused or the limit is reached, and makes nothing', async () => {
    requireAccess.mockResolvedValueOnce({
      ok: false,
      error: { code: 'forbidden', message: 'access denied (action_not_granted)' },
    });
    const refused = await POST(request(valid));
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as { message: string };
    expect(body.message).not.toMatch(/action_not_granted/);
    expect(refused.headers.get('cache-control')).toBe('private, no-store');
    expect(produce).not.toHaveBeenCalled();

    produce.mockResolvedValueOnce({ ok: false, error: { code: 'rate_limited', message: 'x' } });
    expect((await POST(request(valid))).status).toBe(429);
  });

  it('asks a stale session to confirm identity for a restricted photo, and retries with a fresh proof', async () => {
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

    const proof = { genuine: true };
    requireAccess.mockResolvedValueOnce({
      ok: false,
      error: { code: 'step_up_required', message: 'reauth' },
    });
    stepUp.mockResolvedValueOnce({ kind: 'proof', proof });
    const fresh = await POST(request(valid));
    expect(fresh.status).toBe(200);
    expect(requireAccess.mock.calls.at(-1)?.[4]).toEqual({ purpose: EACH, stepUp: proof });
  });

  it('never sends a return address off the site', async () => {
    requireAccess.mockResolvedValueOnce({
      ok: false,
      error: { code: 'step_up_required', message: 'reauth' },
    });
    stepUp.mockResolvedValueOnce({ kind: 'reauth_required', reauthUrl: '/auth/reauth' });
    await POST(request({ ...valid, returnTo: 'https://evil.example/' }));
    expect(stepUp.mock.calls[0]?.[1]).toBe('/app');
  });
});
