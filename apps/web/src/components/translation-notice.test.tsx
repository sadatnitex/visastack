import { createTranslator } from '@visastack/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TranslationNotice } from './translation-notice';

const t = createTranslator('bn');

describe('TranslationNotice', () => {
  it('tells a Bangla reader that the legal review of this wording is not finished', () => {
    const html = renderToStaticMarkup(<TranslationNotice catalog="consent" locale="bn" t={t} />);
    expect(html).toContain('পেশাদার আইনি পর্যালোচনা এখনও শেষ হয়নি');
    expect(html).toContain('lang="bn"');
    expect(html).toContain('ইংরেজি সংস্করণ');
  });

  it('is not shown in English, where there is nothing to review', () => {
    expect(renderToStaticMarkup(<TranslationNotice catalog="consent" locale="en" t={t} />)).toBe(
      '',
    );
  });

  it('is not shown on a screen whose Bangla is ordinary copy', () => {
    expect(renderToStaticMarkup(<TranslationNotice catalog="account" locale="bn" t={t} />)).toBe(
      '',
    );
    expect(renderToStaticMarkup(<TranslationNotice catalog="shell" locale="bn" t={t} />)).toBe('');
  });
});
