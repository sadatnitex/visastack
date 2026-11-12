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
        <I18nProvider locale="en">
          <Probe />
        </I18nProvider>,
      ),
    ).toContain('Save / 2 files');
  });

  it('renders Bengali when the provider gives bn', () => {
    const html = renderToString(
      <I18nProvider locale="bn">
        <Probe />
      </I18nProvider>,
    );
    expect(html).toContain('সংরক্ষণ করুন / ২ ফাইল');
    expect(html).toContain('data-locale="bn"');
  });

  it('hydrates server-rendered Bengali without a mismatch', async () => {
    const tree = (
      <I18nProvider locale="bn">
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
});
