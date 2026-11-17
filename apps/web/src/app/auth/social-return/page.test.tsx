import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('server-only', () => ({}));
const getSession = vi.fn();
vi.mock('../../../lib/neon-request-session', () => ({
  requestSessionReader: () => ({ getSession }),
}));
const mustAcknowledgeNotices = vi.fn();
vi.mock('../../../lib/notice-gate', () => ({
  mustAcknowledgeNotices: (...args: unknown[]) => mustAcknowledgeNotices(...args),
}));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: async (work: (db: unknown) => Promise<unknown>) => work({ db: true }),
}));

import SocialReturnPage from './page';

const INVITE = '/app/invitations/accept?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const signedIn = { data: { user: { id: 'neon-user-1', email: 'p@example.test' } } };

async function landed(next?: string | string[]): Promise<string> {
  try {
    await SocialReturnPage({
      searchParams: Promise.resolve(next === undefined ? {} : { next }),
    });
  } catch (error) {
    return String((error as Error).message).replace('REDIRECT:', '');
  }
  throw new Error('the page must always redirect');
}

beforeEach(() => {
  redirect.mockClear();
  getSession.mockReset();
  mustAcknowledgeNotices.mockReset().mockResolvedValue(false);
});

describe('where Google sign-in returns to', () => {
  it('sends a signed-in person on to where they were headed, with no email confirmation line', async () => {
    getSession.mockResolvedValue(signedIn);
    expect(await landed()).toBe('/app');
    expect(await landed(INVITE)).toBe(INVITE);
    expect(mustAcknowledgeNotices).toHaveBeenCalledWith(
      { db: true },
      { id: 'neon-user-1', email: 'p@example.test' },
    );
  });

  it('sends a new person through the agreement step first, keeping where they were headed', async () => {
    getSession.mockResolvedValue(signedIn);
    mustAcknowledgeNotices.mockResolvedValue(true);
    expect(await landed()).toBe('/auth/notice-check?next=%2Fapp');
    expect(await landed(INVITE)).toBe(`/auth/notice-check?next=${encodeURIComponent(INVITE)}`);
  });

  it('goes straight on when the question cannot be answered (the session check asks again)', async () => {
    getSession.mockResolvedValue(signedIn);
    mustAcknowledgeNotices.mockRejectedValue(new Error('database down'));
    expect(await landed()).toBe('/app');
  });

  it('sends anyone with no session to the sign-in form with the Google message', async () => {
    getSession.mockResolvedValue({ data: null });
    expect(await landed()).toBe('/auth/sign-in?e=social');
    expect(await landed(INVITE)).toBe(`/auth/sign-in?e=social&next=${encodeURIComponent(INVITE)}`);
    expect(mustAcknowledgeNotices).not.toHaveBeenCalled();
  });

  it('treats an unreadable session as no session', async () => {
    getSession.mockRejectedValue(new Error('network'));
    expect(await landed()).toBe('/auth/sign-in?e=social');
  });

  it('never goes anywhere outside the site, signed in or not', async () => {
    for (const next of ['https://evil.example', '//evil.example', ['/app/a', '/app/b']]) {
      getSession.mockResolvedValueOnce(signedIn);
      expect(await landed(next)).toBe('/app');
      getSession.mockResolvedValueOnce({ data: null });
      expect(await landed(next)).toBe('/auth/sign-in?e=social');
    }
  });
});
