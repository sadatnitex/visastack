import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../components/locale-provider';
import { latinWords, textOf } from '../lib/next-mocks.test-support';

const { default: AppError } = await import('./error');
const { default: GlobalError } = await import('./global-error');
const { default: NotFound } = await import('./not-found');
const { localeState } = await import('../lib/next-mocks.test-support');

const error = Object.assign(new Error('boom'), { digest: 'abc123' });

function inLocale(locale: 'en' | 'bn') {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <AppError error={error} reset={vi.fn()} />
    </LocaleProvider>,
  );
}

describe('the error screen', () => {
  it('reads as it always has in English, including the reference', () => {
    const text = textOf(inLocale('en'));
    expect(text).toContain('Something went wrong');
    expect(text).toContain('We hit a snag loading this page');
    expect(text).toContain('Nothing you had entered on this page was lost or corrupted.');
    expect(text).toContain('Try again');
    expect(text).toContain('Back to home');
    expect(text).toContain('Reference: abc123');
  });

  it('speaks Bangla to a Bangla reader, from the first paint, with the reference kept', () => {
    const text = textOf(inLocale('bn'));
    expect(text).toContain('কিছু ভুল হয়েছে');
    expect(text).toContain('এই পাতাটি লোড করতে গিয়ে সমস্যা হয়েছে');
    expect(text).toContain('আবার চেষ্টা করুন');
    expect(text).toContain('হোম পাতায় ফিরুন');
    expect(text).toContain('রেফারেন্স: abc123');
    expect([...new Set(latinWords(text))]).toEqual(['abc123']);
  });

  it('shows English when nothing has told it the language', () => {
    const html = renderToStaticMarkup(<AppError error={error} reset={vi.fn()} />);
    expect(textOf(html)).toContain('Something went wrong');
  });
});

describe('the last-resort error screen', () => {
  it('says the same thing in both languages, because the layout that knew the language is what failed', () => {
    const html = renderToStaticMarkup(<GlobalError error={error} reset={vi.fn()} />);
    const text = textOf(html);
    expect(text).toContain('Something went wrong');
    expect(text).toContain('কিছু ভুল হয়েছে');
    expect(text).toContain('An unexpected error interrupted the page. Please try again.');
    expect(text).toContain('একটি অপ্রত্যাশিত ত্রুটিতে পাতাটি থেমে গেছে');
    expect(text).toContain('Try again');
    expect(text).toContain('আবার চেষ্টা করুন');
    expect(text).toContain('Reference: abc123');
    expect(text).toContain('রেফারেন্স: abc123');
    expect(html).toContain('<span lang="bn">');
    expect(html).toContain('<span lang="en">');
  });
});

describe('the not-found page', () => {
  it('is in English by default', async () => {
    localeState.value = 'en';
    const text = textOf(renderToStaticMarkup(await NotFound()));
    expect(text).toContain("We couldn't find that page");
    expect(text).toContain('Go to workspace');
    expect(text).toContain('Back to home');
  });

  it('is in Bangla for a Bangla reader', async () => {
    localeState.value = 'bn';
    const text = textOf(renderToStaticMarkup(await NotFound()));
    expect(text).toContain('আমরা সেই পাতাটি খুঁজে পাইনি');
    expect(text).toContain('ওয়ার্কস্পেসে যান');
    expect(text).toContain('হোম পাতায় ফিরুন');
    expect(latinWords(text)).toEqual([]);
    localeState.value = 'en';
  });
});
