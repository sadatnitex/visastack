import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('server-only', () => ({}));
/** The browser's cookie jar, as the confirmation page would see it. */
const jar = new Map<string, { value: string; options: unknown }>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: unknown) => {
      jar.set(name, { value, options });
    },
  }),
}));

const signInEmail = vi.fn();
const signUpEmail = vi.fn();
const signupAccountExists = vi.fn();
vi.mock('../../lib/signup-account', () => ({
  signupAccountExists: (email: string) => signupAccountExists(email),
}));
const sendVerificationEmail = vi.fn();
const requestPasswordReset = vi.fn();
const resetPassword = vi.fn();
const getSession = vi.fn();
vi.mock('../../lib/neon-auth', () => ({
  getNeonAuth: () => ({
    signIn: { email: signInEmail },
    signUp: { email: signUpEmail },
    sendVerificationEmail,
    requestPasswordReset,
    resetPassword,
    getSession,
  }),
}));

const withinAuthLimits = vi.fn(async (_input?: unknown) => true);
vi.mock('../../lib/auth-throttle', () => ({
  withinAuthLimits: (input: unknown) => withinAuthLimits(input),
}));
vi.mock('../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://app.example.test' }));
const readSignupForm = vi.fn();
const consumeSignupForm = vi.fn();
vi.mock('../../lib/signup-form', () => ({
  readSignupForm: (token: string) => readSignupForm(token),
  consumeSignupForm: (input: unknown) => consumeSignupForm(input),
}));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function destination(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String(error).replace('Error: REDIRECT:', '');
  }
  return 'no redirect';
}

beforeEach(() => {
  vi.clearAllMocks();
  withinAuthLimits.mockResolvedValue(true);
  readSignupForm.mockReturnValue({ formId: 'trusted-form' });
  consumeSignupForm.mockResolvedValue(true);
  signupAccountExists.mockResolvedValue(false);
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'z'.repeat(64));
  jar.clear();
});

describe('signInAction', () => {
  it.each([
    ['a bad email address', { email: 'nope', password: 'longenough' }],
    ['a short password', { email: 'a@b.co', password: 'short' }],
    ['no fields', {}],
  ])('rejects %s before calling the provider', async (_label, values) => {
    const { signInAction } = await import('./actions');
    expect(await destination(() => signInAction(form(values)))).toBe('/auth/sign-in?e=invalid');
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('shows one generic message for any provider failure, never the provider text', async () => {
    signInEmail.mockResolvedValue({ error: { message: 'User not found', code: 'INVALID_EMAIL' } });
    const { signInAction } = await import('./actions');
    expect(
      await destination(() => signInAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/auth/sign-in?e=failed');
  });

  it('sends an unconfirmed address to the confirmation page, and only for that exact code', async () => {
    const { signInAction } = await import('./actions');
    signInEmail.mockResolvedValue({ error: { code: 'EMAIL_NOT_VERIFIED', status: 403 } });
    expect(
      await destination(() => signInAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/auth/verify-email');
    signInEmail.mockResolvedValue({ error: { code: 'INVALID_ORIGIN', status: 403 } });
    expect(
      await destination(() => signInAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/auth/sign-in?e=failed');
  });

  it('stops over-limit attempts before the provider is called', async () => {
    withinAuthLimits.mockResolvedValue(false);
    const { signInAction } = await import('./actions');
    expect(
      await destination(() => signInAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/auth/sign-in?e=slow');
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('goes to the app on success, or to a safe same-site page, never off-site', async () => {
    signInEmail.mockResolvedValue({ error: null });
    const { signInAction } = await import('./actions');
    expect(
      await destination(() => signInAction(form({ email: ' a@b.co ', password: 'longenough' }))),
    ).toBe('/app');
    expect(signInEmail).toHaveBeenCalledWith({ email: 'a@b.co', password: 'longenough' });
    expect(
      await destination(() =>
        signInAction(form({ email: 'a@b.co', password: 'longenough', next: '/app/cases' })),
      ),
    ).toBe('/app/cases');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'app']) {
      expect(
        await destination(() =>
          signInAction(form({ email: 'a@b.co', password: 'longenough', next: bad })),
        ),
      ).toBe('/app');
    }
  });
});

describe('signUpAction', () => {
  it('offers recovery for a registered address without creating or changing its account', async () => {
    signupAccountExists.mockResolvedValue(true);
    const { signUpAction } = await import('./actions');
    expect(await destination(() => signUpAction(signup()))).toBe('/auth/sign-up?e=exists');
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('does not invent an account result when the lookup fails', async () => {
    signupAccountExists.mockRejectedValue(new Error('database unavailable'));
    const { signUpAction } = await import('./actions');
    expect(await destination(() => signUpAction(signup()))).toBe('/auth/sign-up?e=unavailable');
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it.each(['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'EMAIL_EXISTS'])(
    'recognizes a concurrent registration reported as %s',
    async (code) => {
      signUpEmail.mockResolvedValue({ error: { code } });
      const { signUpAction } = await import('./actions');
      expect(await destination(() => signUpAction(signup()))).toBe('/auth/sign-up?e=exists');
    },
  );
  function signup(values: Record<string, string> = {}): FormData {
    return form({
      email: 'a@b.co',
      password: 'longenough',
      acceptNotices: 'yes',
      signupForm: 'signed',
      ...values,
    });
  }

  it('requires acknowledgement even when browser validation is bypassed', async () => {
    signUpEmail.mockResolvedValue({ error: null });
    const { signUpAction } = await import('./actions');
    expect(await destination(() => signUpAction(signup({ acceptNotices: '' })))).toBe(
      '/auth/sign-up?e=notices',
    );
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(consumeSignupForm).not.toHaveBeenCalled();
  });

  it('refuses automation traps and invalid forms before calling the provider', async () => {
    const { signUpAction } = await import('./actions');
    expect(await destination(() => signUpAction(signup({ website: 'https://bot.test' })))).toBe(
      '/auth/sign-up?e=refresh',
    );
    expect(readSignupForm).not.toHaveBeenCalled();
    readSignupForm.mockReturnValue(null);
    expect(await destination(() => signUpAction(signup()))).toBe('/auth/sign-up?e=refresh');
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(consumeSignupForm).not.toHaveBeenCalled();
  });

  it('refuses replayed forms or unavailable acknowledgement storage before sending email', async () => {
    consumeSignupForm.mockResolvedValue(false);
    const { signUpAction } = await import('./actions');
    expect(await destination(() => signUpAction(signup()))).toBe('/auth/sign-up?e=refresh');
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('rejects bad input, shows a generic failure, and sends a success to the confirmation page', async () => {
    const { signUpAction } = await import('./actions');
    expect(await destination(() => signUpAction(signup({ password: 'short' })))).toBe(
      '/auth/sign-up?e=invalid',
    );
    signUpEmail.mockResolvedValue({ error: { message: 'User already exists' } });
    expect(await destination(() => signUpAction(signup()))).toBe('/auth/sign-up?e=failed');
    signUpEmail.mockResolvedValue({ error: null });
    expect(await destination(() => signUpAction(signup({ name: 'Ana' })))).toBe(
      '/auth/verify-email?s=1',
    );
    expect(signUpEmail).toHaveBeenLastCalledWith({
      email: 'a@b.co',
      password: 'longenough',
      name: 'Ana',
      callbackURL: 'https://app.example.test/auth/sign-in?n=confirmed',
    });
  });

  it('falls back to a name taken from the address when none is given', async () => {
    signUpEmail.mockResolvedValue({ error: null });
    const { signUpAction } = await import('./actions');
    await destination(() => signUpAction(signup({ email: 'maria@b.co' })));
    expect(signUpEmail).toHaveBeenCalledWith(expect.objectContaining({ name: 'maria' }));
  });

  it('refuses over-limit sign-ups, and also when the limit cannot be checked (it sends email)', async () => {
    withinAuthLimits.mockResolvedValue(false);
    const { signUpAction } = await import('./actions');
    expect(await destination(() => signUpAction(signup()))).toBe('/auth/sign-up?e=slow');
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(withinAuthLimits).toHaveBeenCalledWith(expect.objectContaining({ onFailure: 'deny' }));
  });
});

describe('password recovery', () => {
  it('gives the same answer whether or not the address has an account', async () => {
    const { requestPasswordResetAction } = await import('./actions');
    requestPasswordReset.mockResolvedValue({ error: null });
    const known = await destination(() => requestPasswordResetAction(form({ email: 'a@b.co' })));
    requestPasswordReset.mockResolvedValue({ error: { message: 'User not found', status: 400 } });
    const unknown = await destination(() => requestPasswordResetAction(form({ email: 'x@y.co' })));
    expect(known).toBe('/auth/forgot-password?sent=1');
    expect(unknown).toBe(known);
    expect(requestPasswordReset).toHaveBeenLastCalledWith({
      email: 'x@y.co',
      redirectTo: 'https://app.example.test/auth/reset-password',
    });
  });

  it('shows a retry message for provider outages and a wait message for throttling', async () => {
    const { requestPasswordResetAction } = await import('./actions');
    for (const status of [400, 401, 403, 404, 500, 503]) {
      requestPasswordReset.mockResolvedValue({ error: { status } });
      expect(await destination(() => requestPasswordResetAction(form({ email: 'a@b.co' })))).toBe(
        '/auth/forgot-password?e=unavailable',
      );
    }
    requestPasswordReset.mockRejectedValue(new Error('network failure'));
    expect(await destination(() => requestPasswordResetAction(form({ email: 'a@b.co' })))).toBe(
      '/auth/forgot-password?e=unavailable',
    );
    requestPasswordReset.mockResolvedValue({ error: { status: 429 } });
    expect(await destination(() => requestPasswordResetAction(form({ email: 'a@b.co' })))).toBe(
      '/auth/forgot-password?e=slow',
    );
  });

  it('rejects a bad address and over-limit requests before sending anything', async () => {
    const { requestPasswordResetAction } = await import('./actions');
    expect(await destination(() => requestPasswordResetAction(form({ email: 'nope' })))).toBe(
      '/auth/forgot-password?e=invalid',
    );
    withinAuthLimits.mockResolvedValue(false);
    expect(await destination(() => requestPasswordResetAction(form({ email: 'a@b.co' })))).toBe(
      '/auth/forgot-password?e=slow',
    );
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(withinAuthLimits).toHaveBeenCalledWith(expect.objectContaining({ onFailure: 'deny' }));
  });

  it('checks the new password before using the one-time code', async () => {
    const { resetPasswordAction } = await import('./actions');
    expect(
      await destination(() =>
        resetPasswordAction(form({ token: 'tok', password: 'short', confirm: 'short' })),
      ),
    ).toBe('/auth/reset-password?token=tok&e=invalid');
    expect(
      await destination(() =>
        resetPasswordAction(form({ token: 'tok', password: 'longenough', confirm: 'different1' })),
      ),
    ).toBe('/auth/reset-password?token=tok&e=mismatch');
    expect(
      await destination(() =>
        resetPasswordAction(form({ password: 'longenough', confirm: 'longenough' })),
      ),
    ).toBe('/auth/forgot-password?e=expired');
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('changes the password, and treats a bad or used code as expired without provider text', async () => {
    const { resetPasswordAction } = await import('./actions');
    resetPassword.mockResolvedValue({ error: null });
    expect(
      await destination(() =>
        resetPasswordAction(form({ token: 'tok', password: 'longenough', confirm: 'longenough' })),
      ),
    ).toBe('/auth/sign-in?n=reset');
    expect(resetPassword).toHaveBeenCalledWith({ newPassword: 'longenough', token: 'tok' });
    resetPassword.mockResolvedValue({ error: { code: 'INVALID_TOKEN', message: 'secret detail' } });
    expect(
      await destination(() =>
        resetPasswordAction(form({ token: 'bad', password: 'longenough', confirm: 'longenough' })),
      ),
    ).toBe('/auth/forgot-password?e=expired');
  });
});

describe('resendConfirmationAction', () => {
  it('reports provider outages, rejected sender settings and throttling without claiming delivery', async () => {
    const { resendConfirmationAction } = await import('./actions');
    for (const error of [
      { status: 500, message: 'private provider detail' },
      { status: 400, code: 'INVALID_ORIGIN' },
      { status: 404, code: 'ROUTE_NOT_FOUND' },
    ]) {
      sendVerificationEmail.mockResolvedValue({ error });
      expect(await destination(() => resendConfirmationAction(form({ email: 'a@b.co' })))).toBe(
        '/auth/verify-email?e=unavailable',
      );
    }
    sendVerificationEmail.mockRejectedValue(new Error('private network detail'));
    expect(await destination(() => resendConfirmationAction(form({ email: 'a@b.co' })))).toBe(
      '/auth/verify-email?e=unavailable',
    );
    sendVerificationEmail.mockResolvedValue({ error: { status: 429 } });
    expect(await destination(() => resendConfirmationAction(form({ email: 'a@b.co' })))).toBe(
      '/auth/verify-email?e=slow',
    );
    sendVerificationEmail.mockResolvedValue({ error: null });
    expect(await destination(() => resendConfirmationAction(form({ email: 'a@b.co' })))).toBe(
      '/auth/verify-email?s=1',
    );
  });

  it('gives the same answer for every address, and is limited', async () => {
    const { resendConfirmationAction } = await import('./actions');
    sendVerificationEmail.mockResolvedValue({ error: { code: 'USER_NOT_FOUND' } });
    expect(await destination(() => resendConfirmationAction(form({ email: 'a@b.co' })))).toBe(
      '/auth/verify-email?s=1',
    );
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: 'a@b.co',
      callbackURL: 'https://app.example.test/auth/sign-in?n=confirmed',
    });
    expect(await destination(() => resendConfirmationAction(form({ email: 'bad' })))).toBe(
      '/auth/verify-email?e=invalid',
    );
    withinAuthLimits.mockResolvedValue(false);
    sendVerificationEmail.mockClear();
    expect(await destination(() => resendConfirmationAction(form({ email: 'a@b.co' })))).toBe(
      '/auth/verify-email?e=slow',
    );
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe('reauthAction', () => {
  it('uses the signed-in address from the session, never one from the form', async () => {
    const { reauthAction } = await import('./actions');
    getSession.mockResolvedValue({ data: { user: { email: 'me@b.co' } } });
    signInEmail.mockResolvedValue({ error: null });
    expect(
      await destination(() =>
        reauthAction(
          form({ password: 'longenough', returnTo: '/app/privacy', email: 'evil@b.co' }),
        ),
      ),
    ).toBe('/app/privacy');
    expect(signInEmail).toHaveBeenCalledWith({ email: 'me@b.co', password: 'longenough' });
  });

  it('asks again on a wrong password, goes to sign-in with no session, and never leaves the site', async () => {
    const { reauthAction } = await import('./actions');
    getSession.mockResolvedValue({ data: { user: { email: 'me@b.co' } } });
    signInEmail.mockResolvedValue({ error: { message: 'bad' } });
    expect(
      await destination(() =>
        reauthAction(form({ password: 'longenough', returnTo: '//evil.test' })),
      ),
    ).toBe('/auth/reauth?returnTo=%2Fapp&e=failed');
    getSession.mockResolvedValue({ data: null });
    expect(await destination(() => reauthAction(form({ password: 'longenough' })))).toBe(
      '/auth/sign-in',
    );
  });
});

describe('invitation account handoff', () => {
  function signup(values: Record<string, string> = {}): FormData {
    return form({
      email: 'a@b.co',
      password: 'longenough',
      acceptNotices: 'yes',
      signupForm: 'signed',
      ...values,
    });
  }
  const next = '/app/invitations/accept?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  it('returns signup and confirmation to the exact invitation without accepting it', async () => {
    signUpEmail.mockResolvedValue({ error: null });
    sendVerificationEmail.mockResolvedValue({ error: null });
    const { signUpAction, resendConfirmationAction } = await import('./actions');
    const target = `&next=${encodeURIComponent(next)}`;
    expect(await destination(() => signUpAction(signup({ next })))).toBe(
      `/auth/verify-email?s=1${target}`,
    );
    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: `https://app.example.test/auth/sign-in?n=confirmed${target}`,
      }),
    );
    expect(await destination(() => resendConfirmationAction(form({ email: 'a@b.co', next })))).toBe(
      `/auth/verify-email?s=1${target}`,
    );
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: `https://app.example.test/auth/sign-in?n=confirmed${target}`,
      }),
    );
  });
  it('keeps invitation context on existing-account and unconfirmed-email outcomes', async () => {
    const { signUpAction, signInAction } = await import('./actions');
    signupAccountExists.mockResolvedValue(true);
    expect(await destination(() => signUpAction(signup({ next })))).toBe(
      `/auth/sign-up?e=exists&next=${encodeURIComponent(next)}`,
    );
    signInEmail.mockResolvedValue({ error: { code: 'EMAIL_NOT_VERIFIED' } });
    expect(
      await destination(() =>
        signInAction(form({ email: 'a@b.co', password: 'longenough', next })),
      ),
    ).toBe(`/auth/verify-email?next=${encodeURIComponent(next)}`);
  });
  it('refuses an external signup return address', async () => {
    signUpEmail.mockResolvedValue({ error: null });
    const { signUpAction } = await import('./actions');
    expect(await destination(() => signUpAction(signup({ next: '//evil.example' })))).toBe(
      '/auth/verify-email?s=1',
    );
    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: 'https://app.example.test/auth/sign-in?n=confirmed' }),
    );
  });
});

describe('the confirmation page remembers the address (no typing it twice)', () => {
  const COOKIE = 'vs_pending_confirmation';

  it('remembers the address after a successful sign-up, signed, server-only and for /auth only', async () => {
    signUpEmail.mockResolvedValue({ error: null });
    const { signUpAction } = await import('./actions');
    const to = await destination(() =>
      signUpAction(
        form({
          email: 'new@traveller.test',
          password: 'longenough',
          acceptNotices: 'yes',
          signupForm: 'signed',
        }),
      ),
    );
    expect(to).toBe('/auth/verify-email?s=1');
    const saved = jar.get(COOKIE);
    expect(saved?.options).toMatchObject({ httpOnly: true, secure: true, path: '/auth' });
    const { decodePendingConfirmation } = await import('../../lib/pending-confirmation');
    expect(decodePendingConfirmation(saved?.value)).toBe('new@traveller.test');
  });

  it('sends the link again to the remembered address with one tap, nothing typed', async () => {
    const { encodePendingConfirmation } = await import('../../lib/pending-confirmation');
    jar.set(COOKIE, { value: encodePendingConfirmation('new@traveller.test') ?? '', options: {} });
    sendVerificationEmail.mockResolvedValue({ error: null });
    const { resendConfirmationAction } = await import('./actions');
    expect(await destination(() => resendConfirmationAction(form({ saved: '1' })))).toBe(
      '/auth/verify-email?s=1',
    );
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@traveller.test' }),
    );
  });

  it('a typed address always wins over the remembered one', async () => {
    const { encodePendingConfirmation } = await import('../../lib/pending-confirmation');
    jar.set(COOKIE, { value: encodePendingConfirmation('old@traveller.test') ?? '', options: {} });
    sendVerificationEmail.mockResolvedValue({ error: null });
    const { resendConfirmationAction } = await import('./actions');
    await destination(() =>
      resendConfirmationAction(form({ saved: '1', email: 'typed@traveller.test' })),
    );
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'typed@traveller.test' }),
    );
  });

  it('a forged or missing remembered address sends nothing and asks for the address', async () => {
    jar.set(COOKIE, { value: 'forged.value', options: {} });
    const { resendConfirmationAction } = await import('./actions');
    expect(await destination(() => resendConfirmationAction(form({ saved: '1' })))).toBe(
      '/auth/verify-email?e=invalid',
    );
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});
