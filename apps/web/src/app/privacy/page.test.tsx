import { SIGNUP_PRIVACY_VERSION } from '@visastack/services';
import { afterEach, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';
import PrivacyPage from './page';

const beta = vi.hoisted(() => ({ open: true }));
vi.mock('../../lib/identity-selection', () => ({ selectedIdentityProvider: () => 'neon_auth' }));
vi.mock('../../lib/public-beta', () => ({ isPublicBetaOpen: () => beta.open }));
afterEach(() => {
  vi.unstubAllEnvs();
  beta.open = true;
});

it('discloses the configured R2 document and archive processor with the updated notice version', async () => {
  vi.stubEnv('STORAGE_PROVIDER', 'r2');
  const html = await renderServer(<PrivacyPage />);
  expect(html).toContain('Cloudflare R2 stores private files');
  expect(html).toContain('encrypted backup archives when backups are configured');
  expect(html).toContain(SIGNUP_PRIVACY_VERSION);
  expect(SIGNUP_PRIVACY_VERSION).not.toBe('2026-10-10.1');
  expect(html).not.toContain('own risk');
  expect(html).not.toContain('virus');
  expect(html).toContain('awaits legal review');
});
it('retains the alternate file provider without claiming that all deployments use R2 documents', async () => {
  vi.stubEnv('STORAGE_PROVIDER', 'vercel_blob');
  const html = await renderServer(<PrivacyPage />);
  expect(html).toContain('Vercel stores private files');
  expect(html).not.toContain('Cloudflare R2 stores private files');
  expect(html).toContain('Cloudflare R2 stores');
});

it('names database-backed document storage accurately', async () => {
  vi.stubEnv('STORAGE_PROVIDER', 'neon');
  const html = await renderServer(<PrivacyPage />);
  expect(html).toContain('Neon stores private files');
  expect(html).not.toContain('Vercel stores private files');
});
it('does not invent a document provider when selection is absent', async () => {
  vi.stubEnv('STORAGE_PROVIDER', '');
  const html = await renderServer(<PrivacyPage />);
  expect(html).toContain('The configured private storage service stores private files');
  expect(html).not.toContain('Vercel stores private files');
});

it('in public beta mode points to the Terms and not the made-up-details rule', async () => {
  beta.open = true;
  const html = await renderServer(<PrivacyPage />);
  expect(html).toContain('you may add your own information and documents.');
  expect(html).not.toContain('own risk');
  expect(html).not.toContain('Real applicant details are not accepted yet');
});

it('in pilot mode repeats the made-up-details rule and does not invite real details', async () => {
  beta.open = false;
  const html = await renderServer(<PrivacyPage />);
  expect(html).toContain('Please use made-up details');
  expect(html).toContain('Real applicant details are not accepted yet');
  expect(html).not.toContain('you may add your own information and documents');
});
