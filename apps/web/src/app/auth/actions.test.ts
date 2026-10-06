import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

const signInEmail = vi.fn();
const signUpEmail = vi.fn();
vi.mock('../../lib/neon-auth', () => ({
  getNeonAuth: () => ({ signIn: { email: signInEmail }, signUp: { email: signUpEmail } }),
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
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
});

describe('signInAction', () => {
  it('does nothing and goes home when Neon Auth is not the selected provider', async () => {
    vi.stubEnv('IDENTITY_PROVIDER', 'workos');
    const { signInAction } = await import('./actions');
    expect(
      await destination(() => signInAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/');
    expect(signInEmail).not.toHaveBeenCalled();
  });

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
    signInEmail.mockResolvedValue({ error: { message: 'User not found' } });
    const { signInAction } = await import('./actions');
    expect(
      await destination(() => signInAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/auth/sign-in?e=failed');
  });

  it('goes to the app on success', async () => {
    signInEmail.mockResolvedValue({ error: null });
    const { signInAction } = await import('./actions');
    expect(
      await destination(() => signInAction(form({ email: ' a@b.co ', password: 'longenough' }))),
    ).toBe('/app');
    expect(signInEmail).toHaveBeenCalledWith({ email: 'a@b.co', password: 'longenough' });
  });
});

describe('signUpAction', () => {
  it('goes home when Neon Auth is not selected', async () => {
    vi.stubEnv('IDENTITY_PROVIDER', 'workos');
    const { signUpAction } = await import('./actions');
    expect(
      await destination(() => signUpAction(form({ email: 'a@b.co', password: 'longenough' }))),
    ).toBe('/');
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('rejects bad input, shows a generic failure, and sends a success to the sign-in page', async () => {
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
    ).toBe('/auth/sign-in?n=created');
    expect(signUpEmail).toHaveBeenLastCalledWith({
      email: 'a@b.co',
      password: 'longenough',
      name: 'Ana',
    });
  });

  it('falls back to a name taken from the address when none is given', async () => {
    signUpEmail.mockResolvedValue({ error: null });
    const { signUpAction } = await import('./actions');
    await destination(() => signUpAction(form({ email: 'maria@b.co', password: 'longenough' })));
    expect(signUpEmail).toHaveBeenCalledWith(expect.objectContaining({ name: 'maria' }));
  });
});
