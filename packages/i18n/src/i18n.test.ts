import { describe, expect, it } from 'vitest';
import { tokensOf } from './catalog';
import { fill, formatDate, formatDateTime, formatNumber, splitRich } from './format';
import { formatTag } from './locales';
import { BN, CATALOG_LIST, EN, type MessageKey, catalogOf } from './messages';
import {
  BANGLA_REVIEW_RECORDS,
  type BanglaReviewRecord,
  banglaReviewPending,
  isBanglaReviewPending,
  reviewAreasFor,
} from './review';
import { createI18n, createTranslator, resolveLocale } from './translator';

const BENGALI_SCRIPT = new RegExp(
  `[${String.fromCharCode(0x0980)}-${String.fromCharCode(0x09ff)}]`,
  'u',
);

/** Built from its code point so this file itself never contains the character it forbids. */
const EM_DASH = String.fromCharCode(0x2014);

/** Zero-width and direction marks that arrive by accident in pasted text. The Bangla joiners U+200C and U+200D are real spelling and are not in this list. */
const STRAY_INVISIBLE = new RegExp(
  `[${[0x200b, 0x200e, 0x200f, 0x2060, 0xfeff].map((code) => String.fromCharCode(code)).join('')}]`,
);

/** Latin-script words that are allowed to stay in Bangla text: the brand and the names of file formats and services. */
const ALLOWED_LATIN = new Set(['VisaStack', 'Vercel', 'Neon', 'JSON', 'CSV', 'ZIP']);

function allEntries(locale: 'en' | 'bn'): Array<[string, string, string]> {
  return CATALOG_LIST.flatMap((catalog) =>
    Object.entries(catalog[locale] as Readonly<Record<string, string>>).map(
      ([key, text]): [string, string, string] => [catalog.meta.id, key, text],
    ),
  );
}

function richTags(text: string): string[] {
  return [...text.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort();
}

describe('i18n - bilingual translator', () => {
  it('translates in English and Bangla', () => {
    const en = createTranslator('en');
    const bn = createTranslator('bn');
    expect(en('consent.core.title')).toBe('Core processing consent');
    expect(bn('consent.core.title')).toBe('মূল প্রক্রিয়াকরণ সম্মতি');
  });

  it('interpolates parameters, writing numbers in the locale digits and leaving text exactly as given', () => {
    const en = createTranslator('en');
    const bn = createTranslator('bn');
    expect(en('mission.readiness.missing', { count: 3 })).toBe('3 requirement(s) still needed');
    expect(bn('mission.readiness.missing', { count: 3 })).toBe('৩টি প্রয়োজনীয় নথি এখনও বাকি');
    expect(en('grant.pending', { recipient: 'Acme' })).toBe('Waiting for Acme to accept.');
    // A person's name is never converted, even when it has digits or joiners in it.
    expect(bn('grant.pending', { recipient: 'রহিম 2' })).toBe('রহিম 2 গ্রহণ করার অপেক্ষায়।');
  });

  it('leaves a token with no value visible rather than dropping it', () => {
    expect(fill('Hello {name}', {})).toBe('Hello {name}');
    expect(fill('No tokens here')).toBe('No tokens here');
  });

  it('resolves unknown locales to the default', () => {
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('bn')).toBe('bn');
    expect(formatTag('en')).toBe('en-GB');
    expect(formatTag('bn')).toBe('bn-BD');
  });

  it('falls back to the English message if a Bangla one is somehow absent', () => {
    // The catalogs are complete by type; this proves the safety net if that is bypassed.
    const original = BN['consent.required'];
    try {
      (BN as Record<string, string | undefined>)['consent.required'] = undefined;
      expect(createTranslator('bn')('consent.required')).toBe(EN['consent.required']);
    } finally {
      (BN as Record<string, string>)['consent.required'] = original;
    }
  });
});

describe('i18n - plurals', () => {
  it('chooses the singular and plural form in English', () => {
    const { tn } = createI18n('en');
    expect(tn('account.applicants.count', 1)).toBe('1 record');
    expect(tn('account.applicants.count', 0)).toBe('0 records');
    expect(tn('account.applicants.count', 2)).toBe('2 records');
  });

  it('uses the same wording for every count in Bangla and writes the number in Bengali digits', () => {
    const { tn } = createI18n('bn');
    expect(tn('account.applicants.count', 1)).toBe('১টি রেকর্ড');
    expect(tn('account.applicants.count', 12)).toBe('১২টি রেকর্ড');
  });

  it('only accepts a base that has both forms', () => {
    const { tn } = createI18n('en');
    // @ts-expect-error 'consent.required' has no .one/.other pair
    expect(() => tn('consent.required', 1)).not.toThrow();
  });

  it('every .one has a matching .other and the reverse, in both languages', () => {
    for (const locale of ['en', 'bn'] as const) {
      const keys = new Set(allEntries(locale).map(([, key]) => key));
      for (const key of keys) {
        if (key.endsWith('.one')) expect(keys.has(`${key.slice(0, -4)}.other`)).toBe(true);
        if (key.endsWith('.other')) expect(keys.has(`${key.slice(0, -6)}.one`)).toBe(true);
      }
    }
  });
});

describe('i18n - catalog integrity', () => {
  it('declares every key once and gives every English key a Bangla message', () => {
    const en = allEntries('en');
    const bn = allEntries('bn');
    expect(new Set(en.map(([, key]) => key)).size).toBe(en.length);
    expect(bn.map(([, key]) => key).sort()).toEqual(en.map(([, key]) => key).sort());
    expect(Object.keys(BN).sort()).toEqual(Object.keys(EN).sort());
  });

  it('keeps every key a consumer relies on', () => {
    const legacy: MessageKey[] = [
      'consent.core.title',
      'consent.ai.title',
      'consent.ocr.title',
      'consent.sharing.title',
      'consent.marketing.title',
      'consent.issuerContact.title',
      'consent.required',
      'consent.action.grant',
      'consent.action.revoke',
      'mission.readiness.missing',
      'mission.readiness.ready',
      'mission.readiness.needsReview',
      'mission.readiness.manualOnly',
      'document.scanning',
      'document.quarantined',
      'document.status.clean',
      'document.processing.ready',
      'grant.pending',
      'grant.revoked',
      'grant.status.active',
      'legalHold.active',
      'applicant.relationship.self',
      'nav.signIn',
      'nav.workspace',
      'error.generic.title',
      'error.generic.body',
      'error.notFound.title',
    ];
    for (const key of legacy) expect(EN[key], key).toBeTruthy();
  });

  it('has no empty message in either language', () => {
    for (const locale of ['en', 'bn'] as const) {
      for (const [catalog, key, text] of allEntries(locale)) {
        expect(text.trim().length, `${catalog}:${key} (${locale})`).toBeGreaterThan(0);
      }
    }
  });

  it('uses the same {tokens} and the same <b>/<link> tags in Bangla as in English', () => {
    const bn = new Map(allEntries('bn').map(([, key, text]) => [key, text]));
    for (const [catalog, key, en] of allEntries('en')) {
      const translated = bn.get(key) ?? '';
      expect([...tokensOf(translated)].sort(), `${catalog}:${key} tokens`).toEqual(
        [...tokensOf(en)].sort(),
      );
      expect(richTags(translated), `${catalog}:${key} tags`).toEqual(richTags(en));
    }
  });

  it('writes Bangla in Bengali script, with no untranslated English left in', () => {
    for (const [catalog, key, text] of allEntries('bn')) {
      const words = text
        .replace(/\{\w+\}/g, '')
        .replace(/<\/?\w+>/g, '')
        .match(/[A-Za-z][A-Za-z0-9]*/g);
      const stray = (words ?? []).filter((word) => !ALLOWED_LATIN.has(word));
      expect(stray, `${catalog}:${key} has untranslated words`).toEqual([]);
      const letters = text.replace(/\{\w+\}|<\/?\w+>/g, '').match(/\p{L}/gu);
      if (letters) expect(BENGALI_SCRIPT.test(text), `${catalog}:${key} is not Bengali`).toBe(true);
    }
  });

  it('stores every message in canonical (NFC) Unicode form', () => {
    for (const locale of ['en', 'bn'] as const) {
      for (const [catalog, key, text] of allEntries(locale)) {
        expect(text.normalize('NFC'), `${catalog}:${key} (${locale})`).toBe(text);
      }
    }
  });

  it('contains no em-dash, and no stray invisible characters other than the Bangla joiners', () => {
    for (const locale of ['en', 'bn'] as const) {
      for (const [catalog, key, text] of allEntries(locale)) {
        expect(text.includes(EM_DASH), `${catalog}:${key} (${locale}) has an em-dash`).toBe(false);
        // U+200C and U+200D are real parts of Bangla spelling; anything else invisible is a paste accident.
        expect(STRAY_INVISIBLE.test(text), `${catalog}:${key} (${locale})`).toBe(false);
      }
    }
  });

  it('uses the product vocabulary, never an internal name, in anything a reader sees', () => {
    // Directive Part 9 section 1: no "mission", "provider schema" or "job lease" for ordinary travellers.
    const internal = [/\bmissions?\b/i, /provider schema/i, /job lease/i];
    for (const [catalog, key, text] of allEntries('en')) {
      for (const pattern of internal) {
        expect(pattern.test(text), `${catalog}:${key} mentions ${pattern}`).toBe(false);
      }
    }
  });

  it('has no stray spacing or placeholder text in any message', () => {
    for (const locale of ['en', 'bn'] as const) {
      for (const [catalog, key, text] of allEntries(locale)) {
        expect(text, `${catalog}:${key} (${locale}) has outer whitespace`).toBe(text.trim());
        expect(/ {2,}/.test(text), `${catalog}:${key} (${locale}) has a double space`).toBe(false);
        expect(/todo|lorem|xxx/i.test(text), `${catalog}:${key} (${locale}) looks unfinished`).toBe(
          false,
        );
      }
    }
  });

  it('knows which catalog a key belongs to', () => {
    expect(catalogOf('consent.core.title')).toBe('consent');
    expect(catalogOf('alert.documentExpiry.subject')).toBe('alerts');
    expect(catalogOf('legalHold.active')).toBe('privacy');
  });
});

describe('i18n - formatting', () => {
  it('writes counts and years without a thousands separator, in the locale digits', () => {
    expect(formatNumber('en', 2026)).toBe('2026');
    expect(formatNumber('bn', 2026)).toBe('২০২৬');
    expect(formatNumber('bn', 1.5)).toBe('১.৫');
  });

  it('writes dates in the readers language, day first, in a fixed named zone', () => {
    const instant = '2026-10-05T23:30:00Z';
    expect(formatDate('en', instant)).toBe('5 Oct 2026');
    expect(formatDate('en', instant, 'long')).toBe('5 October 2026');
    expect(formatDate('bn', instant)).toBe('৫ অক্টো, ২০২৬');
    expect(formatDateTime('en', instant)).toBe('5 Oct 2026, 23:30 UTC');
    expect(formatDateTime('bn', instant)).toBe('৫ অক্টো, ২০২৬, ২৩:৩০ UTC');
  });

  it('reads a date-only value as the calendar day it was written as', () => {
    expect(formatDate('en', '2020-01-15')).toBe('15 Jan 2020');
  });
});

describe('i18n - rich text', () => {
  it('splits a message into plain and tagged pieces', () => {
    expect(splitRich('Grant <b>Core processing</b> from <link>Overview</link>.')).toEqual([
      { tag: null, text: 'Grant ' },
      { tag: 'b', text: 'Core processing' },
      { tag: null, text: ' from ' },
      { tag: 'link', text: 'Overview' },
      { tag: null, text: '.' },
    ]);
  });

  it('leaves unknown angle brackets as plain text', () => {
    expect(splitRich('a <script>x</script> b')).toEqual([
      { tag: null, text: 'a <script>x</script> b' },
    ]);
  });

  it('is applied to the template, so a typed value shaped like a tag stays text', () => {
    const [piece] = splitRich('<b>{name}</b>');
    expect(piece).toEqual({ tag: 'b', text: '{name}' });
    expect(fill(piece?.text ?? '', { name: '<b>x</b>' })).toBe('<b>x</b>');
  });
});

describe('i18n - professional review of the Bangla', () => {
  it('marks consent, privacy, sharing, readiness and upload wording as needing a professional', () => {
    expect(reviewAreasFor('consent')).toEqual(expect.arrayContaining(['CONSENT', 'LEGAL']));
    expect(reviewAreasFor('privacy')).toEqual(expect.arrayContaining(['PRIVACY', 'LEGAL']));
    expect(reviewAreasFor('sharing')).toContain('CONSENT');
    expect(reviewAreasFor('readiness')).toContain('LEGAL');
    expect(reviewAreasFor('upload')).toContain('SECURITY');
    expect(reviewAreasFor('alerts')).toContain('PRIVACY');
    expect(reviewAreasFor('shell')).toEqual([]);
    expect(reviewAreasFor('account')).toEqual([]);
  });

  it('records no professional review yet, so every sensitive catalog is pending', () => {
    // This pins the honest current state. When a real review is recorded in review.ts this
    // expectation is meant to change in the same commit.
    expect(Object.keys(BANGLA_REVIEW_RECORDS)).toEqual([]);
    expect(banglaReviewPending()).toEqual(
      CATALOG_LIST.filter((c) => c.meta.review.length > 0).map((c) => c.meta.id),
    );
  });

  it('clears a catalog only when the record covers every area it lists', () => {
    const partial: Partial<Record<'consent', BanglaReviewRecord>> = {
      consent: { reviewer: 'A. Reviewer, advocate', reviewedOn: '2026-11-01', areas: ['CONSENT'] },
    };
    expect(isBanglaReviewPending('consent', partial)).toBe(true);
    const full: Partial<Record<'consent', BanglaReviewRecord>> = {
      consent: {
        reviewer: 'A. Reviewer, advocate',
        reviewedOn: '2026-11-01',
        areas: ['CONSENT', 'PRIVACY', 'LEGAL'],
      },
    };
    expect(isBanglaReviewPending('consent', full)).toBe(false);
    expect(isBanglaReviewPending('shell')).toBe(false);
  });
});
