import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The email sign-in link landing (Q8). Each guard here has a test that fails without it: the
 * browser must be the one that asked (login CSRF), a link never makes a staff sign-in, a new
 * person meets the agreement and invitation step first, and the return target stays on site.
 */

vi.mock('server-only', () => ({}));
const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));
const signOut = vi.fn();
vi.mock('../../../lib/neon-auth', () => ({
  getNeonAuth: () => ({ signOut }),
  readNeonAuthSettings: () => ({ baseUrl: 'https://auth.example.test', cookieSecret: SECRET }),
}));
const getSession = vi.fn();
vi.mock('../../../lib/neon-request-session', () => ({
  requestSessionReader: () => ({ getSession }),
}));
const emailIsStaff = vi.fn();
vi.mock('../../../lib/sign-in-link-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/sign-in-link-guard')>()),
  emailIsStaff: (email: string) => emailIsStaff(email),
}));
const mustAcknowledgeNotices = vi.fn();
vi.mock('../../../lib/notice-gate', () => ({
  mustAcknowledgeNotices: (...args: unknown[]) => mustAcknowledgeNotices(...args),
}));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: async (work: (db: unknown) => Promise<unknown>) => work({ db: true }),
}));
vi.mock('../../../lib/server-error', () => ({ reportServerError: vi.fn() }));

import { encodeLinkPending, linkPendingCookieName } from '../../../lib/link-pending';
import { GET } from './route';

const PENDING = linkPendingCookieName(true);

async function land(next = '/app/cases'): Promise<string> {
  const response = await GET(
    new Request(`https://app.example.test/auth/link-return?next=${encodeURIComponent(next)}`),
  );
  const location = new URL(response.headers.get('location') ?? '');
  return `${location.pathname}${location.search}`;
}

beforeEach(async () => {
  jar.clear();
  jar.set(PENDING, await encodeLinkPending(SECRET));
  signOut.mockReset().mockResolvedValue({});
  getSession.mockReset().mockResolvedValue({
    data: { user: { id: 'neon-1', email: 'p@example.test' } },
  });
  emailIsStaff.mockReset().mockResolvedValue(false);
  mustAcknowledgeNotices.mockReset().mockResolvedValue(false);
});

describe('the sign-in link landing', () => {
  it('lets a traveller in this browser go on, and forgets the pending mark', async () => {
    expect(await land()).toBe('/app/cases');
    expect(signOut).not.toHaveBeenCalled();
    expect(jar.has(PENDING)).toBe(false);
  });

  it('ends a link sign-in in a browser that never asked for a link', async () => {
    jar.clear();
    expect(await land()).toBe('/auth/sign-in?e=link&next=%2Fapp%2Fcases');
    expect(signOut).toHaveBeenCalledTimes(1);
    jar.set(PENDING, 'forged.value');
    expect(await land()).toBe('/auth/sign-in?e=link&next=%2Fapp%2Fcases');
    jar.set(PENDING, await encodeLinkPending(SECRET, Date.now() - 11 * 60 * 1000));
    expect(await land()).toBe('/auth/sign-in?e=link&next=%2Fapp%2Fcases');
    expect(signOut).toHaveBeenCalledTimes(3);
  });

  it('uses each mark once: the same browser cannot finish a second link sign-in with it', async () => {
    expect(await land()).toBe('/app/cases');
    expect(await land()).toBe('/auth/sign-in?e=link&next=%2Fapp%2Fcases');
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('never keeps a staff sign-in made by a link, or one whose role cannot be read', async () => {
    emailIsStaff.mockResolvedValueOnce(true);
    expect(await land()).toBe('/auth/sign-in?e=link_staff&next=%2Fapp%2Fcases');
    jar.set(PENDING, await encodeLinkPending(SECRET));
    emailIsStaff.mockResolvedValueOnce(null);
    expect(await land()).toBe('/auth/sign-in?e=link&next=%2Fapp%2Fcases');
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it('sends a new person through the agreement and invitation step first', async () => {
    mustAcknowledgeNotices.mockResolvedValue(true);
    expect(await land()).toBe('/auth/notice-check?next=%2Fapp%2Fcases');
  });

  it('explains the link when nobody is signed in, and never leaves the site', async () => {
    getSession.mockResolvedValue({ data: null });
    expect(await land()).toBe('/auth/sign-in?e=link&next=%2Fapp%2Fcases');
    getSession.mockResolvedValue({ data: { user: { id: 'neon-1', email: 'p@example.test' } } });
    jar.set(PENDING, await encodeLinkPending(SECRET));
    expect(await land('//evil.example')).toBe('/app');
    jar.set(PENDING, await encodeLinkPending(SECRET));
    expect(await land('https://evil.example/x')).toBe('/app');
  });
});
