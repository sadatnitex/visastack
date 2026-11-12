import { SIGNUP_PRIVACY_VERSION } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import PrivacyPage from './page';

const beta = vi.hoisted(() => ({ open: true }));
vi.mock('../../lib/identity-selection', () => ({ selectedIdentityProvider: () => 'neon_auth' }));
vi.mock('../../lib/public-beta', () => ({ isPublicBetaOpen: () => beta.open }));
afterEach(() => {
  vi.unstubAllEnvs();
  beta.open = true;
});

it('discloses the configured R2 document and archive processor with the updated notice version', () => {
  vi.stubEnv('STORAGE_PROVIDER', 'r2');
  const html = renderToStaticMarkup(<PrivacyPage />);
  expect(html).toContain('Cloudflare R2 stores private files');
  expect(html).toContain('encrypted backup archives when backups are configured');
  expect(html).toContain(SIGNUP_PRIVACY_VERSION);
  expect(SIGNUP_PRIVACY_VERSION).not.toBe('2026-10-10.1');
  expect(html).toContain('at your own risk');
  expect(html).toContain('virus scanning of uploads, are not switched on yet');
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

it('in public beta mode keeps the own-risk wording and not the made-up-details rule', () => {
  beta.open = true;
  const html = renderToStaticMarkup(<PrivacyPage />);
  expect(html).toContain('you may add your own information and documents at your own risk');
  expect(html).not.toContain('Real applicant details are not accepted yet');
});

it('in pilot mode repeats the made-up-details rule and does not invite real details', () => {
  beta.open = false;
  const html = renderToStaticMarkup(<PrivacyPage />);
  expect(html).toContain('Please use made-up details');
  expect(html).toContain('Real applicant details are not accepted yet');
  expect(html).not.toContain('you may add your own information and documents');
});
