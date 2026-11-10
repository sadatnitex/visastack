import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('server-only', () => ({}));
const getSession = vi.fn();
vi.mock('../../../lib/neon-auth', () => ({ getNeonAuth: () => ({ getSession }) }));

import ConfirmedPage from './page';

const INVITE = '/app/invitations/accept?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function landed(next?: string): Promise<string> {
  try {
    await ConfirmedPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });
  } catch (error) {
    return String((error as Error).message).replace('REDIRECT:', '');
  }
  throw new Error('the page must always redirect');
}

beforeEach(() => {
  redirect.mockClear();
  getSession.mockReset();
});

describe('/auth/confirmed', () => {
  it('sends a signed-in person to the home with the confirmed line', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect(await landed()).toBe('/app?confirmed=1');
  });

  it('keeps the validated task and refuses an off-site one', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect(await landed(INVITE)).toBe(INVITE);
    expect(await landed('https://evil.example')).toBe('/app?confirmed=1');
    expect(await landed('//evil.example')).toBe('/app?confirmed=1');
  });

  it('sends a person with no session to the sign-in form, keeping the task', async () => {
    getSession.mockResolvedValue({ data: null, error: null });
    expect(await landed()).toBe('/auth/sign-in?n=confirmed');
    expect(await landed(INVITE)).toBe(
      `/auth/sign-in?n=confirmed&next=${encodeURIComponent(INVITE)}`,
    );
  });

  it('treats a failed session read as signed out, never as an error page', async () => {
    getSession.mockRejectedValue(new Error('network'));
    expect(await landed()).toBe('/auth/sign-in?n=confirmed');
  });
});
