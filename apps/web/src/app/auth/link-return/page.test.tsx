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

import LinkReturnPage from './page';

const signedIn = { data: { user: { id: 'neon-user-1', email: 'p@example.test' } } };

async function landed(next?: string): Promise<string> {
  try {
    await LinkReturnPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });
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

describe('the email sign-in link landing (Q8)', () => {
  it('sends a signed-in person on to where they were headed', async () => {
    getSession.mockResolvedValue(signedIn);
    expect(await landed('/app/cases')).toBe('/app/cases');
  });

  it('sends a new person through the agreement and invitation step first', async () => {
    getSession.mockResolvedValue(signedIn);
    mustAcknowledgeNotices.mockResolvedValue(true);
    expect(await landed('/app/cases')).toBe('/auth/notice-check?next=%2Fapp%2Fcases');
  });

  it('explains the link when nobody is signed in, and never leaves the site', async () => {
    getSession.mockResolvedValue({ data: null });
    expect(await landed('/app/cases')).toBe('/auth/sign-in?e=link&next=%2Fapp%2Fcases');
    getSession.mockRejectedValue(new Error('down'));
    expect(await landed('//evil.example')).toBe('/auth/sign-in?e=link');
    getSession.mockResolvedValue(signedIn);
    expect(await landed('https://evil.example')).toBe('/app');
  });
});
