import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  redirect: (to: string) => redirect(to),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
const getSession = vi.fn();
vi.mock('../../../lib/neon-request-session', () => ({
  requestSessionReader: () => ({ getSession }),
}));
const mustAcknowledgeNotices = vi.fn();
vi.mock('../../../lib/notice-gate', () => ({
  mustAcknowledgeNotices: (...args: unknown[]) => mustAcknowledgeNotices(...args),
}));
const checkPilotAccess = vi.fn();
vi.mock('../../../lib/pilot-access', () => ({
  checkPilotAccess: (...args: unknown[]) => checkPilotAccess(...args),
}));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: async (work: (db: unknown) => Promise<unknown>) => work({ db: true }),
}));

import AcceptTermsPage from './page';

const user = { id: 'neon-user-1', email: 'p@example.test', emailVerified: true };

async function visit(searchParams: Record<string, string> = {}): Promise<Document | string> {
  try {
    const html = renderToStaticMarkup(
      await AcceptTermsPage({ searchParams: Promise.resolve(searchParams) }),
    );
    return new JSDOM(html).window.document;
  } catch (error) {
    return String((error as Error).message).replace('REDIRECT:', '');
  }
}

beforeEach(() => {
  redirect.mockClear();
  getSession.mockReset().mockResolvedValue({ data: { user } });
  mustAcknowledgeNotices.mockReset().mockResolvedValue(true);
  checkPilotAccess.mockReset().mockResolvedValue({ allowed: true });
});

describe('One Last Step page', () => {
  it('asks a new Google sign-in to agree, with the tick required and the destination carried', async () => {
    const document = (await visit({ next: '/app/documents' })) as Document;
    const box = document.querySelector<HTMLInputElement>('input[name="acceptNotices"]');
    expect(box?.required).toBe(true);
    expect(box?.value).toBe('yes');
    expect(document.querySelector('input[name="next"]')?.getAttribute('value')).toBe(
      '/app/documents',
    );
    expect(document.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(document.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(document.querySelector('button[type="submit"]')?.textContent).toBe('Agree and Continue');
    expect(mustAcknowledgeNotices).toHaveBeenCalledWith(
      { db: true },
      { id: 'neon-user-1', email: 'p@example.test' },
    );
  });

  it('sends a person with nothing to agree to straight on', async () => {
    mustAcknowledgeNotices.mockResolvedValue(false);
    expect(await visit({ next: '/app/documents' })).toBe('/app/documents');
    expect(await visit()).toBe('/app');
  });

  it('sends someone who is not invited to say so instead of asking them to agree', async () => {
    checkPilotAccess.mockResolvedValue({ allowed: false });
    expect(await visit()).toBe('/pilot-access-denied');
  });

  it('sends someone with no session to sign in and someone unconfirmed to confirm', async () => {
    getSession.mockResolvedValue({ data: null });
    expect(await visit()).toBe('/auth/sign-in?next=%2Fauth%2Faccept-terms');
    getSession.mockResolvedValue({ data: { user: { ...user, emailVerified: false } } });
    expect(await visit()).toBe('/auth/verify-email');
  });

  it('shows the form, not a redirect, when the check itself cannot be made', async () => {
    mustAcknowledgeNotices.mockRejectedValue(new Error('database down'));
    const document = (await visit()) as Document;
    expect(document.querySelector('input[name="acceptNotices"]')).not.toBeNull();
    expect(document.querySelector('#notices-error')).toBeNull();
  });

  it('shows the reason a save failed or the tick was missing', async () => {
    const failed = (await visit({ e: 'failed' })) as Document;
    expect(failed.querySelector('#notices-error')?.textContent).toContain('could not save');
    const missing = (await visit({ e: 'notices' })) as Document;
    expect(missing.querySelector('#notices-error')?.textContent).toContain('terms and privacy');
  });

  it('never carries a destination outside the site, and marks its English text', async () => {
    const document = (await visit({ next: 'https://evil.example' })) as Document;
    expect(document.querySelector('input[name="next"]')?.getAttribute('value')).toBe('/app');
    expect(document.querySelector('[lang="en"] form')).not.toBeNull();
  });
});
