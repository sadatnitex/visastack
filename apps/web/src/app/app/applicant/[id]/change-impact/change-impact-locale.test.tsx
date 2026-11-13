// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { changeImpactCatalog } from '../../../../../i18n/change-impact';
import { partsTranslator } from '../../../../../lib/language-parts';
import '../../../../../lib/next-mocks.test-support';
import { bengaliWithoutLanguageMark } from '../bn-coverage.test-support';
import { ChangeImpactFailed } from './change-impact-failed';
import { ChangeImpactNotice } from './change-impact-notice';
import { ChangeImpactReview } from './change-impact-review';
import { ALL_REVIEWS, APPLICANT_ID, DETAIL_RECORDED } from './fixtures.test-support';
import { changeImpactSummary } from './impact-words';

/**
 * What This Change Affects for a reader who chose Bengali. The catalogue has no Bengali yet, so
 * every sentence falls back to English: it must render, say that it is English where the page is
 * Bengali, and keep its date in the digits of the language the sentence is written in.
 */

const BENGALI = /[ঀ-৿]/;
const en = partsTranslator(changeImpactCatalog, 'en', 'en');
/** A Bengali reader on a page that is marked Bengali. */
const bn = partsTranslator(changeImpactCatalog, 'bn', 'bn');
/** A Bengali reader on a page that is still marked English. */
const bnOnEnglishPage = partsTranslator(changeImpactCatalog, 'bn', 'en');

const text = (markup: string) => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
};

describe('the change-impact catalogue', () => {
  const sources = JSON.parse(
    readFileSync(join(process.cwd(), 'src', 'i18n', 'change-impact.sources.json'), 'utf8'),
  ) as Record<string, unknown>;

  it('names every key surface.component.slot in lower camel case', () => {
    for (const key of Object.keys(changeImpactCatalog.en)) {
      expect(key).toMatch(/^changeImpact(\.[a-z][A-Za-z0-9]*){2,3}$/);
    }
  });

  it('has a sources entry for every key and no other, in the same order', () => {
    expect(Object.keys(sources)).toEqual(Object.keys(changeImpactCatalog.en));
    // No register group yet: the screen was built after the census.
    expect(new Set(Object.values(sources))).toEqual(new Set([null]));
  });

  it('holds no Bengali yet, so nothing unreviewed can reach a screen', () => {
    expect(Object.keys(changeImpactCatalog.bn)).toEqual([]);
    for (const value of Object.values(changeImpactCatalog.en)) expect(value).not.toMatch(BENGALI);
  });

  it('keeps plural messages complete: every plural has its other branch', () => {
    const plurals = Object.values(changeImpactCatalog.en).filter((v) => v.includes(', plural,'));
    expect(plurals).toHaveLength(3);
    for (const value of plurals) expect(value).toMatch(/one \{[^{}]+\} other \{[^{}]+\}\}$/);
  });
});

describe('a Bengali reader', () => {
  it('sees the same English as an English reader, without a crash, in every review', () => {
    for (const [name, impact] of Object.entries(ALL_REVIEWS)) {
      const props = { impact, applicantId: APPLICANT_ID };
      const english = renderToStaticMarkup(<ChangeImpactReview {...props} t={en} locale="en" />);
      const fallback = renderToStaticMarkup(<ChangeImpactReview {...props} t={bn} locale="bn" />);
      expect(text(fallback), name).toBe(text(english));
      expect(text(fallback), name).not.toMatch(BENGALI);
    }
  });

  it('gets English marked as English on a Bengali page, and unmarked on an English page', () => {
    const props = { impact: DETAIL_RECORDED, applicantId: APPLICANT_ID };
    const onBengali = renderToStaticMarkup(<ChangeImpactReview {...props} t={bn} locale="bn" />);
    expect(onBengali).toContain('<span lang="en">What This Change Affects</span>');
    expect(onBengali).toContain('<span lang="en">Needs Your Action</span>');
    const onEnglish = renderToStaticMarkup(
      <ChangeImpactReview {...props} t={bnOnEnglishPage} locale="bn" />,
    );
    expect(onEnglish).not.toContain('lang=');
    expect(onEnglish).toBe(
      renderToStaticMarkup(<ChangeImpactReview {...props} t={en} locale="en" />),
    );
    expect(bengaliWithoutLanguageMark(onBengali)).toEqual([]);
  });

  it('reads dates in Latin digits inside an English sentence', () => {
    const markup = renderToStaticMarkup(
      <ChangeImpactReview impact={DETAIL_RECORDED} applicantId={APPLICANT_ID} t={bn} locale="bn" />,
    );
    expect(text(markup)).toMatch(/you sent on \d{1,2} Oct 2026/);
  });

  it('gets the notice and the failed state in English too', () => {
    const summary = changeImpactSummary(DETAIL_RECORDED, APPLICANT_ID);
    const notice = renderToStaticMarkup(<ChangeImpactNotice summary={summary} t={bn} />);
    expect(text(notice)).toBe(
      text(renderToStaticMarkup(<ChangeImpactNotice summary={summary} t={en} />)),
    );
    expect(text(notice)).toContain('2 items need your action.');
    const failed = renderToStaticMarkup(<ChangeImpactFailed retryHref="/x" t={bn} />);
    expect(text(failed)).toContain('This List Did Not Load');
    expect(failed).toContain('<span lang="en">Try Again</span>');
  });
});
