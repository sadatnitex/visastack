import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getObject, render, recheck } = vi.hoisted(() => ({
  getObject: vi.fn(),
  render: vi.fn(),
  recheck: vi.fn(),
}));
vi.mock('@visastack/adapters', () => ({ verifyBlobToken: () => true }));
vi.mock('@visastack/db', () => ({
  createNeonDb: () => ({}),
  resolveDatabaseUrl: () => 'postgres://placeholder.invalid/db',
}));
vi.mock('@visastack/services', () => ({
  readDocumentAccessToken: () => ({ token: true }),
  verifyDocumentAccessToken: () => true,
  recheckDocumentAccess: recheck,
}));
vi.mock('../../../../lib/providers', () => ({ createPreviewRenderer: () => ({ render }) }));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({ getObject }) }));
vi.mock('../../../../lib/server-error', () => ({ reportRenderFailure: vi.fn() }));

const { GET } = await import('./route');

function get(variant: string, disposition: string) {
  const url = `https://app.example/api/blob/key-1?v=${variant}&d=${disposition}&exp=1&sig=x`;
  return GET(new Request(url), { params: Promise.resolve({ key: 'key-1' }) });
}

const SECRET = 'BLOB_SIGNING_SECRET';

beforeEach(() => {
  process.env[SECRET] = 'test-only';
  getObject.mockReset();
  render.mockReset();
  recheck.mockReset();
  recheck.mockResolvedValue({ allowed: true });
  getObject.mockResolvedValue({ contentType: 'application/pdf', bytes: new Uint8Array([1]) });
  render.mockResolvedValue({
    rendered: true,
    contentType: 'image/png',
    bytes: new Uint8Array([2]),
  });
});

afterEach(() => {
  Reflect.deleteProperty(process.env, SECRET);
});

describe('signed blob route and safe copies (S23)', () => {
  it('never serves a download of the unmasked rendition: safe copies have their own route', async () => {
    const response = await get('redacted', 'download');
    expect(response.status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('still serves the preview rendition inline', async () => {
    const response = await get('redacted', 'inline');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('answers a failed rendition with a plain line, never the renderer detail (server paths, versions)', async () => {
    render.mockResolvedValueOnce({
      rendered: false,
      detail: "image preview render failed: Cannot find module '@napi-rs/canvas' at /var/task/x.js",
    });
    const response = await get('redacted', 'inline');
    expect(response.status).toBe(501);
    const body = await response.text();
    expect(body).toBe('This file cannot be previewed here.');
    expect(body).not.toContain('napi-rs');
    expect(body).not.toContain('/var/task');
  });
});
