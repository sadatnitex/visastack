import { describe, expect, it, vi } from 'vitest';

const choice = vi.hoisted(() => ({ enabled: false, saved: 'bn' as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'visastack_locale' && choice.saved !== undefined
        ? { value: choice.saved }
        : undefined,
  }),
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

  it('is off today: translation is deferred until the owner says the rest is done', () => {
    expect(LANGUAGE_CHOICE_ENABLED).toBe(false);
  });
});
