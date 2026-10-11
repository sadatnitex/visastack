import { SIGNUP_PRIVACY_VERSION } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import PrivacyPage from './page';

vi.mock('../../lib/identity-selection', () => ({ selectedIdentityProvider: () => 'neon_auth' }));
afterEach(() => vi.unstubAllEnvs());

it('discloses the configured R2 document and archive processor with the updated notice version', () => {
  vi.stubEnv('STORAGE_PROVIDER', 'r2');
  const html = renderToStaticMarkup(<PrivacyPage />);
  expect(html).toContain('Cloudflare R2 stores private files');
  expect(html).toContain('encrypted backup archives when backups are configured');
  expect(html).toContain(SIGNUP_PRIVACY_VERSION);
  expect(SIGNUP_PRIVACY_VERSION).not.toBe('2026-10-10.1');
  expect(html).toContain('real sensitive-document intake is not enabled');
  expect(html).toContain('awaits legal review');
});
it('retains the alternate file provider without claiming that all deployments use R2 documents', () => {
  vi.stubEnv('STORAGE_PROVIDER', 'vercel_blob');
  const html = renderToStaticMarkup(<PrivacyPage />);
  expect(html).toContain('Vercel stores private files');
  expect(html).not.toContain('Cloudflare R2 stores private files');
  expect(html).toContain('Cloudflare R2 stores');
});

it('names database-backed document storage accurately', () => {
  vi.stubEnv('STORAGE_PROVIDER', 'neon');
  const html = renderToStaticMarkup(<PrivacyPage />);
  expect(html).toContain('Neon stores private files');
  expect(html).not.toContain('Vercel stores private files');
});
it('does not invent a document provider when selection is absent', () => {
  vi.stubEnv('STORAGE_PROVIDER', '');
  const html = renderToStaticMarkup(<PrivacyPage />);
  expect(html).toContain('The configured private storage service stores private files');
  expect(html).not.toContain('Vercel stores private files');
});
