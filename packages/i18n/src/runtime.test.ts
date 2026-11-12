import { describe, expect, it } from 'vitest';
import { catalogResolve, catalogTranslator, defineCatalog } from './catalog';
import { formatDate, formatMoney, formatNumber, localeTag } from './format';
import { formatMessage } from './icu';
import { BN, EN } from './messages';

const demo = defineCatalog({
  en: {
    'demo.greeting': 'Hello {name}',
    'demo.items': '{count, plural, one {# item} other {# items}}',
    'demo.onlyEnglish': 'Only in English',
    'demo.exact': '{count, plural, =0 {Nothing} one {One} other {Many: #}}',
  },
  bn: {
    'demo.greeting': 'হ্যালো {name}',
    'demo.items': '{count, plural, one {# আইটেম} other {# আইটেম}}',
    'demo.exact': '{count, plural, =0 {কিছু নেই} one {একটি} other {অনেক: #}}',
  },
});

describe('catalog runtime', () => {
  it('interpolates tokens and leaves unknown ones intact', () => {
    const t = catalogTranslator(demo, 'en');
    expect(t('demo.greeting', { name: 'Asha' })).toBe('Hello Asha');
    expect(t('demo.greeting')).toBe('Hello {name}');
    expect(catalogTranslator(demo, 'bn')('demo.greeting', { name: 'আশা' })).toBe('হ্যালো আশা');
  });

  it('plural: English one and other', () => {
    const t = catalogTranslator(demo, 'en');
    expect(t('demo.items', { count: 1 })).toBe('1 item');
    expect(t('demo.items', { count: 2 })).toBe('2 items');
    expect(t('demo.items', { count: 0 })).toBe('0 items');
  });

  it('plural: Bengali treats 0 and 1 as one, with Bengali digits', () => {
    expect(new Intl.PluralRules('bn-BD').select(0)).toBe('one');
    expect(new Intl.PluralRules('bn-BD').select(1)).toBe('one');
    const one = '{count, plural, one {শূন্য বা এক: #} other {অন্য: #}}';
    expect(formatMessage(one, { count: 0 }, 'bn-BD')).toBe('শূন্য বা এক: ০');
    expect(formatMessage(one, { count: 1 }, 'bn-BD')).toBe('শূন্য বা এক: ১');
    expect(formatMessage(one, { count: 5 }, 'bn-BD')).toBe('অন্য: ৫');
  });

  it('plural: exact matches win', () => {
    const t = catalogTranslator(demo, 'en');
    expect(t('demo.exact', { count: 0 })).toBe('Nothing');
    expect(t('demo.exact', { count: 1 })).toBe('One');
    expect(t('demo.exact', { count: 7 })).toBe('Many: 7');
  });

  it('falls back to English for a missing Bengali key', () => {
    expect(catalogTranslator(demo, 'bn')('demo.onlyEnglish')).toBe('Only in English');
  });
});

describe('formatting', () => {
  it('maps locales to tags', () => {
    expect(localeTag('en')).toBe('en-GB');
    expect(localeTag('bn')).toBe('bn-BD');
  });

  it('formatMoney always keeps the ISO code, never a symbol', () => {
    const en = formatMoney(1200, 'GBP', 'en');
    expect(en).toContain('GBP');
    expect(en).not.toContain('£');
    expect(en).toContain('1,200.00');
    const bn = formatMoney(1200, 'BDT', 'bn');
    expect(bn).toContain('BDT');
    expect(bn).not.toContain('৳');
    expect(bn).toContain('১,২০০.০০');
  });

  it('formats numbers and dates per locale', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'bn')).toBe('১,২৩৪.৫');
    const date = new Date(Date.UTC(2026, 10, 12));
    const opts = { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' } as const;
    expect(formatDate(date, 'en', opts)).toBe('12 November 2026');
    expect(formatDate(date, 'bn', opts)).toContain('২০২৬');
  });
});

describe('catalog quality', () => {
  const placeholders = (text: string) =>
    [...text.replace(/(?:zero|one|two|few|many|other|=\d+)\s*\{/g, '(').matchAll(/\{(\w+)\s*[,}]/g)]
      .map((m) => m[1])
      .sort()
      .join(',');
  const pairs: Array<
    [string, Readonly<Record<string, string>>, Readonly<Record<string, string | undefined>>]
  > = [
    ['messages', EN, BN],
    ['demo', demo.en, demo.bn],
  ];

  for (const [name, en, bn] of pairs) {
    it(`${name}: bn placeholders match en, NFC, no em dash`, () => {
      for (const [key, value] of Object.entries(bn)) {
        if (value === undefined) continue;
        expect(en[key], `${name}.${key} has an English source`).toBeDefined();
        expect(placeholders(value), `${name}.${key} placeholders`).toBe(
          placeholders(en[key] as string),
        );
        expect(value.normalize('NFC'), `${name}.${key} NFC`).toBe(value);
        expect(value.includes(String.fromCodePoint(0x2014)), `${name}.${key} em dash`).toBe(false);
      }
    });
  }
});

describe('plural number marker', () => {
  it('leaves a # inside a parameter value unchanged', () => {
    const message = '{count, plural, one {# file from {name}} other {# files from {name}}}';
    expect(formatMessage(message, { count: 2, name: 'Invoice #12' }, 'en-GB')).toBe(
      '2 files from Invoice #12',
    );
  });

  it('uses the inner count in a nested plural', () => {
    const message =
      '{outer, plural, other {# groups, {inner, plural, one {# item} other {# items}}}}';
    expect(formatMessage(message, { outer: 3, inner: 1 }, 'en-GB')).toBe('3 groups, 1 item');
    expect(formatMessage(message, { outer: 3, inner: 5 }, 'en-GB')).toBe('3 groups, 5 items');
  });

  it('keeps # literal outside a plural', () => {
    expect(formatMessage('Case #{id}', { id: 7 }, 'en-GB')).toBe('Case #7');
  });
});

describe('catalogResolve', () => {
  const c = defineCatalog({
    en: { 'x.both': 'Both', 'x.only': 'Only English' },
    bn: { 'x.both': 'দুটোই' },
  });
  it('reports the language actually used', () => {
    expect(catalogResolve(c, 'bn', 'x.both')).toEqual({ text: 'দুটোই', lang: 'bn' });
    expect(catalogResolve(c, 'bn', 'x.only')).toEqual({ text: 'Only English', lang: 'en' });
    expect(catalogResolve(c, 'en', 'x.both')).toEqual({ text: 'Both', lang: 'en' });
  });
  it('formats an English fallback with Latin digits under bn', () => {
    const n = defineCatalog({
      en: { 'x.files': '{n, plural, one {# file} other {# files}}' },
      bn: {},
    });
    expect(catalogResolve(n, 'bn', 'x.files', { n: 1234 })).toEqual({
      text: '1,234 files',
      lang: 'en',
    });
    expect(catalogTranslator(n, 'bn')('x.files', { n: 1234 })).toBe('1,234 files');
  });
});
