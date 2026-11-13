import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../components/i18n-provider';
import { statusCatalog } from '../../i18n/status';
import { textOf } from '../../lib/next-mocks.test-support';
import { type ProbeResult, StatusView } from './status-view';

const BENGALI = /[ঀ-৿]/;
const live: ProbeResult = { ok: true, status: 'live', data: { status: 'live' } };
const ready: ProbeResult = {
  ok: true,
  status: 'ready',
  data: {
    status: 'ready',
    deploymentMode: 'controlled_pilot',
    platform: { authentication: 'available', documentUpload: 'available' },
  },
};

function render(locale: 'en' | 'bn', updatedAt = '14:05:09', probe = ready): string {
  return textOf(
    renderToStaticMarkup(
      <I18nProvider locale={locale} pageLang="en">
        <StatusView
          live={live}
          ready={probe}
          updatedAt={updatedAt}
          loading={false}
          onRefresh={() => undefined}
        />
      </I18nProvider>,
    ),
  );
}

describe('the status page under Bengali', () => {
  it('shows the Bengali headings and buttons, and English for wording with no Bengali yet', () => {
    const text = render('bn');
    expect(text).toContain(statusCatalog.bn['status.statusStatusView.whatWorksToday']);
    expect(text).toContain(statusCatalog.bn['status.statusStatusView.checkNow']);
    expect(text).toContain(statusCatalog.bn['status.statusStatusView.features']);
    // The verdict and feature names come from the platform data and stay in English for now.
    expect(text).toContain('Everything is working');
    expect(text).not.toMatch(/status\.statusStatusView\./);
    expect(text).not.toMatch(/\{[A-Za-z]+\}/);
  });

  it('shows the Bengali loading line before the first check finishes', () => {
    expect(render('bn', '')).toContain(statusCatalog.bn['status.statusStatusView.loading']);
  });

  it('when the feature list cannot be read it says so in Bengali (refill 3)', () => {
    const bare = { ...ready, data: { status: 'ready', deploymentMode: 'controlled_pilot' } };
    const text = render('bn', '14:05:09', bare as ProbeResult);
    expect(text).toContain(statusCatalog.bn['status.statusStatusView.theListOfFeaturesIsNot']);
    expect(text).not.toContain(statusCatalog.en['status.statusStatusView.theListOfFeaturesIsNot']);
    expect(text).not.toMatch(/status\.statusStatusView\./);
  });

  it('has no raw placeholder in any Bengali string', () => {
    for (const [key, value] of Object.entries(statusCatalog.bn))
      expect(value.replace(/\{[A-Za-z]+\}/g, ''), key).not.toMatch(/[{}]/);
  });
});

describe('the status page under English', () => {
  it('renders the original English with no Bengali', () => {
    const text = render('en');
    expect(text).toContain('What Works Today');
    expect(text).toContain('Check Now');
    expect(text).not.toMatch(BENGALI);
  });
});
