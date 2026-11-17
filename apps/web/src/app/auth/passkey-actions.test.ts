import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The passkey server actions (Q8). The WebAuthn checks themselves are proved in
 * `@visastack/services` with a real software passkey; here the rules around them are proved:
 * the switch, the fresh password needed to add or remove, the one-time challenge bound to this
 * sign-in, the shared rate limit, staff, and that nothing here ever signs anyone in.
 */

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('server-only', () => ({}));

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: { maxAge?: number }) => {
      if (options?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

const neonSignIn = { email: vi.fn(), magicLink: vi.fn(), social: vi.fn() };
vi.mock('../../lib/neon-auth', () => ({
  getNeonAuth: () => ({ signIn: neonSignIn, signUp: { email: vi.fn() } }),
  readNeonAuthSettings: () => ({
    baseUrl: 'https://auth.example.test',
    cookieSecret: 'test-only-cookie-key-with-at-least-thirty-two-characters',
  }),
}));
vi.mock('../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://app.example.test' }));

const state = vi.hoisted(() => ({ sessionRef: 'ref-1' as string | null, staff: false }));
vi.mock('../../lib/neon-recency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/neon-recency')>()),
  neonSessionRef: async () => state.sessionRef,
}));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string; email: string }) => unknown) =>
    fn({ db: { fake: true }, accountId: 'acct-1', email: 'p@example.test' }),
}));
vi.mock('../../lib/session-age', () => ({ isStaffContext: async () => state.staff }));
const passwordIsRecent = vi.fn(async () => true);
vi.mock('../../lib/staff-factor', () => ({ passwordIsRecent: () => passwordIsRecent() }));
const withinAuthLimits = vi.fn(async (_input?: unknown) => true);
vi.mock('../../lib/auth-throttle', () => ({
  withinAuthLimits: (input: unknown) => withinAuthLimits(input),
}));

const service = {
  startPasskeyConfirmation: vi.fn(),
  finishPasskeyConfirmation: vi.fn(),
  startPasskeyRegistration: vi.fn(),
  finishPasskeyRegistration: vi.fn(),
  renamePasskey: vi.fn(),
  removePasskey: vi.fn(),
};
vi.mock('@visastack/services/passkeys', () => service);

import {
  finishPasskeyAddAction,
  finishPasskeyConfirmAction,
  removePasskeyAction,
  startPasskeyAddAction,
  startPasskeyConfirmAction,
} from './passkey-actions';

const ANSWER = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} };

beforeEach(() => {
  vi.stubEnv('PASSKEYS', 'on');
  jar.clear();
  state.sessionRef = 'ref-1';
  state.staff = false;
  passwordIsRecent.mockReset().mockResolvedValue(true);
  withinAuthLimits.mockReset().mockResolvedValue(true);
  for (const fn of Object.values(service)) fn.mockReset();
  for (const fn of Object.values(neonSignIn)) fn.mockReset();
  service.startPasskeyConfirmation.mockResolvedValue({ ok: true, value: { challenge: 'chal-1' } });
  service.finishPasskeyConfirmation.mockResolvedValue({
    ok: true,
    value: { confirmedAt: new Date() },
  });
  service.startPasskeyRegistration.mockResolvedValue({ ok: true, value: { challenge: 'chal-2' } });
  service.finishPasskeyRegistration.mockResolvedValue({ ok: true, value: { id: 'pk-1' } });
  service.removePasskey.mockResolvedValue({ ok: true, value: true });
});
afterEach(() => vi.unstubAllEnvs());

async function redirectOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as Error).message.replace('REDIRECT:', '');
  }
  throw new Error('expected a redirect');
}

describe('confirming with a passkey', () => {
  it('records a confirmation for this sign-in and returns to a safe place', async () => {
    expect((await startPasskeyConfirmAction()).ok).toBe(true);
    const finished = await finishPasskeyConfirmAction(ANSWER, '/app/privacy');
    expect(finished).toEqual({ ok: true, next: '/app/privacy' });
    expect(service.finishPasskeyConfirmation).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({
        accountId: 'acct-1',
        expectedChallenge: 'chal-1',
        sessionRef: 'ref-1',
      }),
    );
    await startPasskeyConfirmAction();
    expect(await finishPasskeyConfirmAction(ANSWER, '//evil.example')).toEqual({
      ok: true,
      next: '/app',
    });
  });

  it('never signs anyone in or calls Neon Auth sign-in', async () => {
    await startPasskeyConfirmAction();
    await finishPasskeyConfirmAction(ANSWER, '/app');
    for (const fn of Object.values(neonSignIn)) expect(fn).not.toHaveBeenCalled();
  });

  it('uses each challenge once, and only in the sign-in that asked for it', async () => {
    await startPasskeyConfirmAction();
    expect((await finishPasskeyConfirmAction(ANSWER, '/app')).ok).toBe(true);
    expect(await finishPasskeyConfirmAction(ANSWER, '/app')).toMatchObject({ ok: false });

    await startPasskeyConfirmAction();
    state.sessionRef = 'ref-after-signing-in-again';
    expect(await finishPasskeyConfirmAction(ANSWER, '/app')).toMatchObject({ ok: false });
    expect(service.finishPasskeyConfirmation).toHaveBeenCalledTimes(1);
  });

  it('is rate limited exactly like the password re-check', async () => {
    await startPasskeyConfirmAction();
    withinAuthLimits.mockResolvedValueOnce(false);
    expect(await finishPasskeyConfirmAction(ANSWER, '/app')).toMatchObject({ ok: false });
    expect(withinAuthLimits).toHaveBeenCalledWith({
      email: 'p@example.test',
      byEmail: 'AUTH_SIGN_IN_EMAIL',
      byAddress: 'AUTH_SIGN_IN_IP',
      onFailure: 'allow',
    });
    expect(service.finishPasskeyConfirmation).not.toHaveBeenCalled();
  });

  it('refuses staff, malformed answers, no sign-in, and everything while switched off', async () => {
    state.staff = true;
    expect(await startPasskeyConfirmAction()).toMatchObject({ ok: false });
    state.staff = false;
    await startPasskeyConfirmAction();
    expect(await finishPasskeyConfirmAction({ id: 'x', type: 'other' }, '/app')).toMatchObject({
      ok: false,
    });
    state.sessionRef = null;
    expect(await redirectOf(startPasskeyConfirmAction())).toBe('/auth/sign-in');
    vi.stubEnv('PASSKEYS', 'off');
    state.sessionRef = 'ref-1';
    expect(await startPasskeyConfirmAction()).toMatchObject({ ok: false });
    expect(await finishPasskeyConfirmAction(ANSWER, '/app')).toMatchObject({ ok: false });
    expect(service.startPasskeyConfirmation).toHaveBeenCalledTimes(1);
  });
});

describe('adding and removing a passkey', () => {
  it('needs the password typed in the last five minutes', async () => {
    passwordIsRecent.mockResolvedValue(false);
    const started = await startPasskeyAddAction();
    expect(started).toMatchObject({
      ok: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp%2Faccount%2Fpasskeys',
    });
    expect(service.startPasskeyRegistration).not.toHaveBeenCalled();
    expect(
      await redirectOf(removePasskeyAction(formWith('11111111-1111-4111-8111-111111111111'))),
    ).toBe('/auth/reauth?returnTo=%2Fapp%2Faccount%2Fpasskeys');
    expect(service.removePasskey).not.toHaveBeenCalled();
  });

  it('a password that went stale between the two steps stops the save', async () => {
    expect((await startPasskeyAddAction()).ok).toBe(true);
    passwordIsRecent.mockResolvedValue(false);
    expect(await finishPasskeyAddAction(ANSWER, 'Phone')).toMatchObject({ ok: false });
    expect(service.finishPasskeyRegistration).not.toHaveBeenCalled();
  });

  it('saves with the add challenge only, never a confirm one', async () => {
    await startPasskeyConfirmAction();
    expect(await finishPasskeyAddAction(ANSWER, 'Phone')).toMatchObject({ ok: false });
    await startPasskeyAddAction();
    expect(await finishPasskeyAddAction(ANSWER, 'Phone')).toEqual({
      ok: true,
      next: '/app/account/passkeys',
    });
    expect(service.finishPasskeyRegistration).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({ accountId: 'acct-1', expectedChallenge: 'chal-2', label: 'Phone' }),
    );
  });

  it('removes only a well-formed id for the signed-in account', async () => {
    expect(await redirectOf(removePasskeyAction(formWith('not-an-id')))).toBe(
      '/app/account/passkeys?n=invalid',
    );
    expect(service.removePasskey).not.toHaveBeenCalled();
    const id = '11111111-1111-4111-8111-111111111111';
    expect(await redirectOf(removePasskeyAction(formWith(id)))).toBe(
      '/app/account/passkeys?n=removed',
    );
    expect(service.removePasskey).toHaveBeenCalledWith({ fake: true }, { accountId: 'acct-1', id });
  });
});

function formWith(id: string): FormData {
  const data = new FormData();
  data.set('passkeyId', id);
  return data;
}
