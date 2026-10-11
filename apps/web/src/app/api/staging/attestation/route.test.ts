import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';
const secret = 'synthetic-only-attestation-key-over-thirty-two-characters';
const request = () =>
  new Request('https://staging.example.test/api/staging/attestation', {
    headers: { Authorization: `Bearer ${secret}` },
  });
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('E2E_SYNTHETIC_ISOLATION_VERIFIED', 'true');
  vi.stubEnv('STAGING_ATTESTATION_SECRET', secret);
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://synthetic:test@ep-stage-pooler.example.test/stagingdb',
  );
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth-stage.example.test/stagingdb/auth');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'a'.repeat(40));
});
afterEach(() => vi.unstubAllEnvs());
it('is unavailable on production and without explicit staging isolation', () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  expect(GET(request()).status).toBe(404);
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('E2E_SYNTHETIC_ISOLATION_VERIFIED', 'false');
  expect(GET(request()).status).toBe(404);
});
it('requires the separate staging secret before exposing configuration proof', () => {
  const response = GET(new Request('https://staging.example.test/api/staging/attestation'));
  expect(response.status).toBe(401);
});
it('reports resource identifiers and exact code revision without passwords or keys', async () => {
  const response = GET(request());
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain('ep-stage.example.test');
  expect(body).toContain('stagingdb');
  expect(body).not.toContain('test');
  expect(body).not.toContain(secret);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  vi.stubEnv('DATABASE_URL', 'invalid');
  expect(GET(request()).status).toBe(503);
});
