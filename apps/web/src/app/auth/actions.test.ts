import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

const signInEmail = vi.fn();
const signUpEmail = vi.fn();
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

const withinAuthLimits = vi.fn(async () => true);
vi.mock('../../lib/auth-throttle', () => ({
  withinAuthLimits: (input: unknown) => withinAuthLimits(input),
}));
vi.mock('../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://app.example.test' }));

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
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
});

describe('every action', () => {
  it('does nothing and goes home when Neon Auth is not the selected provider', async () => {
    vi.stubEnv('IDENTITY_PROVIDER', 'workos');
    const a = await import('./actions');
    const good = form({
      email: 'a@b.co',
      password: 'longenough',
      confirm: 'longenough',
      token: 't',
    });
    for (const run of [
      () => a.signInAction(good),
      () => a.signUpAction(good),
      () => a.resendConfirmationAction(good),
      () => a.requestPasswordResetAction(good),
      () => a.resetPasswordAction(good),
      () => a.reauthAction(good),
    ]) {
      expect(await destination(run)).toBe('/');
    }
    expect(signInEmail).not.toHaveBeenCalled();
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(resetPassword).not.toHaveBeenCalled();
  });
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
    ).toBe('/auth/verify-email?s=1');
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
  it('rejects bad input, shows a generic failure, and sends a success to the confirmation page', async () => {
    const { signUpAction } = await import('./actions');
    expect(
      await destination(() => signUpAction(form({ email: 'a@b.co', password: 'short' }))),
    ).toBe('/auth/sign-up?e=invalid');
    signUpEmail.mockResolvedValue({ error: { message: 'User already exists' } });
    expect(
      await destination(() => signUpAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/auth/sign-up?e=failed');
    signUpEmail.mockResolvedValue({ error: null });
    expect(
      await destination(() =>
        signUpAction(form({ email: 'a@b.co', password: 'longenough', name: 'Ana' })),
      ),
    ).toBe('/auth/verify-email?s=1');
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
    await destination(() => signUpAction(form({ email: 'maria@b.co', password: 'longenough' })));
    expect(signUpEmail).toHaveBeenCalledWith(expect.objectContaining({ name: 'maria' }));
  });

  it('refuses over-limit sign-ups, and also when the limit cannot be checked (it sends email)', async () => {
    withinAuthLimits.mockResolvedValue(false);
    const { signUpAction } = await import('./actions');
    expect(
      await destination(() => signUpAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/auth/sign-up?e=slow');
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
  it('gives the same answer for every address, and is limited', async () => {
    const { resendConfirmationAction } = await import('./actions');
    sendVerificationEmail.mockResolvedValue({ error: { message: 'no such user' } });
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
