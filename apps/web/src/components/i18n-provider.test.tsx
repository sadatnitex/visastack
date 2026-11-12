// @vitest-environment jsdom
import { defineCatalog } from '@visastack/i18n';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useLocale, useT } from './i18n-provider';

const catalog = defineCatalog({
  en: {
    'demo.button.save': 'Save',
    'demo.button.count': '{count, plural, one {# file} other {# files}}',
  },
  bn: {
    'demo.button.save': 'সংরক্ষণ করুন',
    'demo.button.count': '{count, plural, one {# ফাইল} other {# ফাইল}}',
  },
});

function Probe() {
  const t = useT(catalog);
  return (
    <p data-locale={useLocale()}>
      {`${t('demo.button.save')} / ${t('demo.button.count', { count: 2 })}`}
    </p>
  );
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('I18nProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders English by default and when the locale is en', () => {
    expect(renderToString(<Probe />)).toContain('Save / 2 files');
    expect(
      renderToString(
        <I18nProvider locale="en" pageLang="en">
          <Probe />
        </I18nProvider>,
      ),
    ).toContain('Save / 2 files');
  });

  it('renders Bengali when the provider gives bn', () => {
    const html = renderToString(
      <I18nProvider locale="bn" pageLang="bn">
        <Probe />
      </I18nProvider>,
    );
    expect(html).toContain('সংরক্ষণ করুন / ২ ফাইল');
    expect(html).toContain('data-locale="bn"');
  });

  it('hydrates server-rendered Bengali without a mismatch', async () => {
    const tree = (
      <I18nProvider locale="bn" pageLang="bn">
        <Probe />
      </I18nProvider>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = container.innerHTML;
    await act(async () => {
      hydrateRoot(container, tree, {
        onRecoverableError: (error) => {
          throw error;
        },
      });
    });
    expect(errors).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(before);
  });

  it('gives client translators the page language the layout passed', () => {
    const catalogMixed = defineCatalog({
      en: { 'demo.a': 'A', 'demo.b': 'B' },
      bn: { 'demo.a': 'এ' },
    });
    function Parts() {
      const t = useT(catalogMixed);
      return (
        <p>
          {t.node('demo.a')}|{t.node('demo.b')}
        </p>
      );
    }
    const onEn = renderToString(
      <I18nProvider locale="bn" pageLang="en">
        <Parts />
      </I18nProvider>,
    );
    expect(onEn).toContain('<span lang="bn">এ</span>');
    expect(onEn).not.toContain('lang="en"');
    const onBn = renderToString(
      <I18nProvider locale="bn" pageLang="bn">
        <Parts />
      </I18nProvider>,
    );
    expect(onBn).toContain('<span lang="en">B</span>');
    expect(onBn).not.toContain('lang="bn"');
  });
});
