import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
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

import { collectCatalog } from '../../i18n/collect';
import { primeLocale } from '../../lib/i18n-server';
import { GuestBar } from './guest-progress';

const BENGALI = /[ঀ-৿]/;
const bn = collectCatalog.bn as Record<string, string>;
const en = collectCatalog.en as Record<string, string>;
const sources = JSON.parse(
  readFileSync(join(__dirname, '../../i18n/collect.sources.json'), 'utf8'),
) as Record<string, string>;

/** Register rows held back in English for this surface (consent, sharing and access wording). */
const HELD = [
  'SG-094bebc7',
  'SG-45ad6a0b',
  'SG-2b1514c9',
  'SG-d39a9da3',
  'SG-dc081055',
  'SG-d7bcf439',
];

async function bar(
  locale: 'en' | 'bn',
  placed: number,
  left: number,
  needsLook: number,
  total = 2,
) {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return renderToStaticMarkup(
    <GuestBar placed={placed} left={left} total={total} needsLook={needsLook} />,
  );
}

afterEach(() => {
  current.locale = 'en';
});

describe('the document collection flow under Bengali', () => {
  it('shows Bengali digits and words on every state of the phone summary', async () => {
    const open = await bar('bn', 3, 2, 0);
    // Numbers go in raw; the runtime formats them by the language the message resolves to, so a
    // Bengali message shows Bengali digits.
    expect(open).toContain('২টি বাধ্যতামূলক বাকি');
    expect(open).not.toContain('2 mandatory open');
    expect(await bar('bn', 3, 0, 0)).toContain(
      bn['collect.collectGuestProgress.allMandatoryPlaced'],
    );
    expect(await bar('bn', 0, 0, 0, 0)).toContain(
      bn['collect.collectGuestProgress.nothingMandatory'],
    );
  });

  it('keeps the sentences with no Bengali yet in English instead of showing a key', async () => {
    const look = await bar('bn', 3, 0, 2);
    expect(look).toContain('2 files need a look');
    expect(look).not.toMatch(/collect\./);
  });

  it('keeps consent, sharing and access wording in English', () => {
    const keys = Object.entries(sources)
      .filter(([, group]) => HELD.includes(group))
      .map(([key]) => key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key in bn, key).toBe(false);
      expect(en[key], key).toBeTruthy();
    }
  });

  it('leaves no raw placeholder in any Bengali string', () => {
    for (const [key, text] of Object.entries(bn)) {
      const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(names(text), key).toBe(names(en[key] ?? ''));
    }
  });
});

describe('the document collection flow under English', () => {
  it('renders the original English text with no Bengali', async () => {
    for (const html of [
      await bar('en', 1, 2, 0),
      await bar('en', 3, 0, 1),
      await bar('en', 0, 0, 0, 0),
    ])
      expect(html).not.toMatch(BENGALI);
    expect(await bar('en', 3, 2, 0)).toContain('2 mandatory open');
    expect(await bar('en', 1, 2, 0)).toContain('1 File Placed');
  });
});
