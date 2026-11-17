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

import SocialReturnPage from './page';

const INVITE = '/app/invitations/accept?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
});

describe('where Google sign-in returns to', () => {
  it('sends a signed-in person on to where they were headed, with no email confirmation line', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } } });
    expect(await landed()).toBe('/app');
    expect(await landed(INVITE)).toBe(INVITE);
  });

  it('sends anyone with no session to the sign-in form with the Google message', async () => {
    getSession.mockResolvedValue({ data: null });
    expect(await landed()).toBe('/auth/sign-in?e=social');
    expect(await landed(INVITE)).toBe(`/auth/sign-in?e=social&next=${encodeURIComponent(INVITE)}`);
  });

  it('treats an unreadable session as no session', async () => {
    getSession.mockRejectedValue(new Error('network'));
    expect(await landed()).toBe('/auth/sign-in?e=social');
  });

  it('never goes anywhere outside the site, signed in or not', async () => {
    for (const next of ['https://evil.example', '//evil.example', ['/app/a', '/app/b']]) {
      getSession.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
      expect(await landed(next)).toBe('/app');
      getSession.mockResolvedValueOnce({ data: null });
      expect(await landed(next)).toBe('/auth/sign-in?e=social');
    }
  });
});
