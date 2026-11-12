import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

import { appHomeCatalog } from '../../i18n/app-home';
import { primeLocale } from '../../lib/i18n-server';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';
import { StartCaseTile } from './(home)/home-cards';
import { FirstRunConsent } from './first-run';

const BENGALI = /[ঀ-৿]/;
const bn = appHomeCatalog.bn as Record<string, string>;
const en = appHomeCatalog.en as Record<string, string>;

async function render(locale: 'en' | 'bn', which: 'tile' | 'consent'): Promise<string> {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return textOf(
    await renderServer(
      which === 'tile' ? (
        <StartCaseTile href="/app/cases/new" />
      ) : (
        <FirstRunConsent locale={locale} />
      ),
    ),
  );
}

afterEach(() => {
  current.locale = 'en';
});

describe('the signed-in home under Bengali', () => {
  it('shows the Bengali label on the start-a-case tile', async () => {
    const text = await render('bn', 'tile');
    expect(text).toContain(bn['appHome.appHomeCards.startACase']);
    expect(text).not.toMatch(/appHome\./);
  });

  it('keeps the consent screen in English where the wording is held back', async () => {
    const held = [
      'appHome.appFirstRun.letVisastackProcessMyDetails',
      'appHome.appFirstRun.thisDoesNotTurnOnAi',
      'appHome.appFirstRun.thisIsNeededBeforeAnythingCan',
    ];
    const text = await render('bn', 'consent');
    for (const key of held) {
      expect(key in bn, key).toBe(false);
      expect(text).toContain(en[key] ?? 'MISSING');
    }
    expect(text).not.toMatch(/appHome\.|\{[A-Za-z]+\}/);
  });

  it('leaves no raw placeholder in any Bengali string', () => {
    for (const [key, text] of Object.entries(bn)) {
      // A named value such as {name} is filled at render time; it must match the English one.
      const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(names(text), key).toBe(names(en[key] ?? ''));
      expect(text, key).not.toMatch(/\{[^}\w]|[^\w]\}/);
    }
  });
});

describe('the signed-in home under English', () => {
  it('renders the original English text with no Bengali', async () => {
    expect(await render('en', 'tile')).not.toMatch(BENGALI);
    expect(await render('en', 'consent')).not.toMatch(BENGALI);
  });
});
