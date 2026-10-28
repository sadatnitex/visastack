import { describe, expect, it, vi } from 'vitest';

const choice = vi.hoisted(() => ({ enabled: false, saved: 'bn' as string | undefined }));
const readRequest = vi.hoisted(() => ({ count: 0 }));
vi.mock('next/headers', () => ({
  cookies: async () => (
    readRequest.count++,
    {
      get: (name: string) =>
        name === 'visastack_locale' && choice.saved !== undefined
          ? { value: choice.saved }
          : undefined,
    }
  ),
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
