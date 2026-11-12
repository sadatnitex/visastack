import { afterEach, describe, expect, it, vi } from 'vitest';

const choice = vi.hoisted(() => ({ enabled: false, saved: 'bn' as string | undefined }));
const readRequest = vi.hoisted(() => ({ count: 0 }));
vi.mock('next/headers', () => ({
  cookies: async () => {
    readRequest.count += 1;
    return {
      get: (name: string) =>
        name === 'visastack_locale' && choice.saved !== undefined
          ? { value: choice.saved }
          : undefined,
    };
  },
}));
vi.mock('./language-choice', () => ({
  get LANGUAGE_CHOICE_ENABLED() {
    return choice.enabled;
  },
}));

const { getLocale } = await import('./locale');
const { LANGUAGE_CHOICE_ENABLED } =
  await vi.importActual<typeof import('./language-choice')>('./language-choice');

describe('the language a page is shown in', () => {
  it('is English for everyone while language choice is off, even with Bangla saved earlier', async () => {
    choice.enabled = false;
    choice.saved = 'bn';
    expect(await getLocale()).toBe('en');
  });

  it('follows the saved choice again once language choice is turned on', async () => {
    choice.enabled = true;
    choice.saved = 'bn';
    expect(await getLocale()).toBe('bn');
    choice.saved = undefined;
    expect(await getLocale()).toBe('en');
    choice.enabled = false;
  });

  it('still reads the request while choice is off, so every page stays rendered per request', async () => {
    // A page built ahead of time would carry no fresh script nonce (browser-security.spec).
    choice.enabled = false;
    const before = readRequest.count;
    await getLocale();
    expect(readRequest.count).toBe(before + 1);
  });

  it('is off today: translation is deferred until the owner says the rest is done', () => {
    expect(LANGUAGE_CHOICE_ENABLED).toBe(false);
  });
});

describe('locale preview path (browser checks only)', () => {
  const KEYS = ['LOCALE_PREVIEW', 'VERCEL_ENV', 'DEPLOYMENT_MODE', 'HOSTING_PLATFORM'];
  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = process.env[k];
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    choice.enabled = false;
    choice.saved = 'bn';
  });
  function setup(env: Record<string, string | undefined>) {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    choice.enabled = false;
    choice.saved = 'bn';
  }

  it('shows Bangla from the cookie when the flag is on and nothing says production', async () => {
    setup({ LOCALE_PREVIEW: '1', DEPLOYMENT_MODE: 'development' });
    expect(await getLocale()).toBe('bn');
  });
  it('is English with the flag off', async () => {
    setup({ DEPLOYMENT_MODE: 'development' });
    expect(await getLocale()).toBe('en');
  });
  it('is English for any flag value other than exactly 1', async () => {
    setup({ LOCALE_PREVIEW: 'true', DEPLOYMENT_MODE: 'development' });
    expect(await getLocale()).toBe('en');
  });
  it('is English on Vercel production even with the flag on', async () => {
    setup({ LOCALE_PREVIEW: '1', VERCEL_ENV: 'production', DEPLOYMENT_MODE: 'development' });
    expect(await getLocale()).toBe('en');
  });
  it('is English in controlled pilot or commercial mode even with the flag on', async () => {
    setup({ LOCALE_PREVIEW: '1', DEPLOYMENT_MODE: 'controlled_pilot' });
    expect(await getLocale()).toBe('en');
    setup({ LOCALE_PREVIEW: '1', DEPLOYMENT_MODE: 'commercial' });
    expect(await getLocale()).toBe('en');
  });
  it('is English on the Render fallback even when DEPLOYMENT_MODE says development', async () => {
    setup({ LOCALE_PREVIEW: '1', HOSTING_PLATFORM: 'render', DEPLOYMENT_MODE: 'development' });
    expect(await getLocale()).toBe('en');
  });
  it('is English for an invalid cookie value', async () => {
    setup({ LOCALE_PREVIEW: '1', DEPLOYMENT_MODE: 'development' });
    choice.saved = 'fr';
    expect(await getLocale()).toBe('en');
  });
});
