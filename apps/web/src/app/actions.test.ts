import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The locale cookie (directive Part 9 section 6: Secure/HttpOnly/SameSite as
 * appropriate). Only the server reads it, so scripts must not be able to.
 */

const set = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
// The cookie rules below are tested with language choice on; the gate is tested on its own.
const choice = vi.hoisted(() => ({ enabled: true }));
vi.mock('../lib/language-choice', () => ({
  get LANGUAGE_CHOICE_ENABLED() {
    return choice.enabled;
  },
}));

const { setLocaleAction } = await import('./actions');
const { LOCALE_COOKIE, localeCookieOptions } = await import('../lib/locale');

function form(locale: string): FormData {
  const data = new FormData();
  data.set('locale', locale);
  return data;
}

beforeEach(() => {
  set.mockReset();
  revalidatePath.mockReset();
  choice.enabled = true;
});

describe('setLocaleAction while language choice is off', () => {
  it('saves nothing and refreshes nothing, even when asked directly', async () => {
    choice.enabled = false;
    await setLocaleAction(form('bn'));
    expect(set).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('localeCookieOptions', () => {
  it('is HttpOnly, SameSite=Lax, site-wide and a year long', () => {
    expect(localeCookieOptions(true)).toEqual({
      path: '/',
      maxAge: 31_536_000,
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    });
  });

  it('drops Secure only when asked to', () => {
    expect(localeCookieOptions(false).secure).toBe(false);
    expect(localeCookieOptions(false).httpOnly).toBe(true);
    expect(localeCookieOptions(false).sameSite).toBe('lax');
  });
});

describe('setLocaleAction', () => {
  it('sets the locale cookie as Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await setLocaleAction(form('bn'));
    expect(set).toHaveBeenCalledWith(LOCALE_COOKIE, 'bn', {
      path: '/',
      maxAge: 31_536_000,
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('does not require HTTPS outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    await setLocaleAction(form('en'));
    expect(set).toHaveBeenCalledWith(
      LOCALE_COOKIE,
      'en',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: false }),
    );
  });

  it('falls back to English for a locale it does not know', async () => {
    await setLocaleAction(form('klingon'));
    expect(set).toHaveBeenCalledWith(LOCALE_COOKIE, 'en', expect.anything());
  });
});
