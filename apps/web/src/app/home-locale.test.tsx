import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The locale is set here directly, as the auth screens' test does.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', generation: 0, betaOpen: false }));
vi.mock('../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
// Each cached function keeps its own result, per request.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== current.generation || args.length > 0) {
        seen = current.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => current.betaOpen }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => false }));

import { homeCatalog } from '../i18n/home';

const { default: HomePage } = await import('./page');

const BENGALI = /[\u0980-\u09FF]/;

async function render(locale: 'en' | 'bn') {
  current.locale = locale;
  current.generation += 1;
  return textOf(await renderServer(HomePage({ searchParams: Promise.resolve({}) })));
}

/** The Home page keeps three catalogued messages; every other word is English until localized (R1). */
const KEPT_KEYS = [
  'home.page.inviteOnlyPilot',
  'home.page.seeWhatWorksToday',
  'home.page.forAgencies',
] as const;

describe('the home page words that have a catalogue entry', () => {
  it('reads in English under en, with no Bengali and no raw keys', async () => {
    const text = await render('en');
    for (const key of KEPT_KEYS) expect(text, key).toContain(homeCatalog.en[key]);
    expect(text).toContain('Sign in to get started');
    expect(text).not.toMatch(BENGALI);
    expect(text).not.toMatch(/home\.page\./);
  });

  it('reads in Bengali under bn, with no raw keys or placeholders', async () => {
    const text = await render('bn');
    expect(text).toMatch(BENGALI);
    for (const key of KEPT_KEYS) {
      expect(key in homeCatalog.bn, key).toBe(true);
      expect(text, key).toContain(homeCatalog.bn[key]);
    }
    expect(text).not.toMatch(/home\.(page|countryChecklistPicker)\.[a-zA-Z0-9]+/);
    expect(text).not.toMatch(/\{[A-Za-z]+\}/);
  });

  it('leaves the chapter words in English under bn (no draft yet), never a raw key', async () => {
    const text = await render('bn');
    for (const words of ['One record.', 'Add it once.', 'Know where', 'Start with']) {
      expect(text, words).toContain(words);
    }
  });

  it('keeps the sign-in buttons English where the catalogue has no Bengali yet', async () => {
    for (const key of ['home.page.openYourWorkspace', 'home.page.createYourFreeAccount'] as const) {
      expect(key in homeCatalog.bn, key).toBe(false);
    }
  });

  it('shows the risk notice in Bengali while the public beta is open', async () => {
    current.betaOpen = true;
    try {
      const key = 'home.page.freePublicBeta' as const;
      const text = await render('bn');
      expect(text).toContain(homeCatalog.bn[key] ?? homeCatalog.en[key]);
    } finally {
      current.betaOpen = false;
    }
  });

  it('has no raw placeholder in any Bengali string', () => {
    for (const [key, value] of Object.entries(homeCatalog.bn)) {
      const bare = value.replace(/\{[A-Za-z]+\}/g, '');
      expect(bare, key).not.toMatch(/[{}]/);
    }
  });
});
