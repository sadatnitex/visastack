import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const getSession = vi.fn();
vi.mock('../../../lib/neon-request-session', () => ({
  requestSessionReader: () => ({ getSession }),
}));
const mustAcknowledgeNotices = vi.fn();
const signsInWithPassword = vi.fn();
const markNoticesSettled = vi.fn();
vi.mock('../../../lib/notice-gate', () => ({
  mustAcknowledgeNotices: (...args: unknown[]) => mustAcknowledgeNotices(...args),
  signsInWithPassword: () => signsInWithPassword(),
  markNoticesSettled: (...args: unknown[]) => markNoticesSettled(...args),
}));
const checkPilotAccess = vi.fn();
vi.mock('../../../lib/pilot-access', () => ({
  checkPilotAccess: (...args: unknown[]) => checkPilotAccess(...args),
}));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: async (work: (db: unknown) => Promise<unknown>) => work({ db: true }),
}));
const reportServerError = vi.fn();
vi.mock('../../../lib/server-error', () => ({
  reportServerError: (...args: unknown[]) => reportServerError(...args),
}));

import { GET } from './route';

const ORIGIN = 'https://app.example.test';
const user = { id: 'neon-user-1', email: 'p@example.test', emailVerified: true };

async function check(query = '', headers: Record<string, string> = {}): Promise<string> {
  const response = await GET(new Request(`${ORIGIN}/auth/notice-check${query}`, { headers }));
  expect(response.status).toBe(307);
  return response.headers.get('location') ?? '';
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ data: { user } });
  mustAcknowledgeNotices.mockReset().mockResolvedValue(true);
  signsInWithPassword.mockReset().mockResolvedValue(false);
  markNoticesSettled.mockReset().mockResolvedValue(true);
  checkPilotAccess.mockReset().mockResolvedValue({ allowed: true });
  reportServerError.mockReset();
});

describe('the step before the agreement page', () => {
  it('sends a new Google-only sign-in to the agreement page, carrying where they were headed', async () => {
    expect(await check('?next=%2Fapp%2Fdocuments')).toBe(
      `${ORIGIN}/auth/accept-terms?next=%2Fapp%2Fdocuments`,
    );
    expect(markNoticesSettled).not.toHaveBeenCalled();
  });

  it('lets a person with nothing to agree to go straight on', async () => {
    mustAcknowledgeNotices.mockResolvedValue(false);
    expect(await check('?next=%2Fapp%2Fdocuments')).toBe(`${ORIGIN}/app/documents`);
    expect(signsInWithPassword).not.toHaveBeenCalled();
  });

  it('tells someone who is not invited so before asking them to agree to anything', async () => {
    checkPilotAccess.mockResolvedValue({ allowed: false });
    expect(await check('?next=%2Fapp%2Fdocuments')).toBe(`${ORIGIN}/pilot-access-denied`);
    expect(signsInWithPassword).not.toHaveBeenCalled();
    expect(markNoticesSettled).not.toHaveBeenCalled();
    expect(checkPilotAccess).toHaveBeenCalledWith({ db: true }, { email: 'p@example.test' });
  });

  it('keeps a proof and goes on for a person who came through the sign-up form', async () => {
    signsInWithPassword.mockResolvedValue(true);
    expect(await check()).toBe(`${ORIGIN}/app`);
    expect(markNoticesSettled).toHaveBeenCalledWith('neon-user-1');
  });

  it('asks to agree when the proof cannot be kept, rather than going on without one', async () => {
    signsInWithPassword.mockResolvedValue(true);
    markNoticesSettled.mockResolvedValue(false);
    expect(await check()).toBe(`${ORIGIN}/auth/accept-terms?next=%2Fapp`);
  });

  it('asks to agree, and logs, when the database cannot be read', async () => {
    mustAcknowledgeNotices.mockRejectedValue(new Error('database down'));
    expect(await check()).toBe(`${ORIGIN}/auth/accept-terms?next=%2Fapp`);
    expect(reportServerError).toHaveBeenCalledTimes(1);
  });

  it('sends someone with no session to sign in and someone unconfirmed to confirm', async () => {
    getSession.mockResolvedValue({ data: null });
    expect(await check()).toBe(`${ORIGIN}/auth/sign-in?next=%2Fauth%2Fnotice-check`);
    getSession.mockResolvedValue({ data: { user: { ...user, emailVerified: false } } });
    expect(await check()).toBe(`${ORIGIN}/auth/verify-email`);
    expect(mustAcknowledgeNotices).not.toHaveBeenCalled();
  });

  it('never goes anywhere outside the site, and uses the address the visitor used', async () => {
    expect(await check('?next=https%3A%2F%2Fevil.example')).toBe(
      `${ORIGIN}/auth/accept-terms?next=%2Fapp`,
    );
    expect(
      await check('', { 'x-forwarded-host': 'www.example.test', 'x-forwarded-proto': 'https' }),
    ).toBe('https://www.example.test/auth/accept-terms?next=%2Fapp');
  });
});
