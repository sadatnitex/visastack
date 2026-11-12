import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { bengaliMarking } from '../lib/bengali-marked.test-support';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { I18nProvider } from '../components/i18n-provider';
import { homeCatalog } from '../i18n/home';
import AppError from './error';

const draw = (locale: 'en' | 'bn') =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} pageLang="en">
      <AppError
        error={Object.assign(new Error('boom'), { digest: '99' })}
        reset={() => undefined}
      />
    </I18nProvider>,
  );

describe('the page-level error screen, language of parts', () => {
  it('marks the Bengali on an English page lang="bn"', () => {
    const html = draw('bn');
    expect(html).toContain(homeCatalog.bn['home.error.backToHome']);
    const r = bengaliMarking(html);
    expect(r.unmarked).toEqual([]);
    expect(r.marked).toBeGreaterThan(0);
  });

  it('adds no language markup under English', () => {
    expect(draw('en')).not.toContain('lang="');
  });
});
