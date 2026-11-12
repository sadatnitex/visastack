import type { PublicTrustRoute } from '@visastack/services';
import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The locale is set here directly, as the auth screens' test does.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', generation: 0 }));
vi.mock('../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
// Each cached function keeps its own result, per request.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== current.generation || args.length > 0) {
        seen = current.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listPublicTrustPublished: async () => [route()],
  getPublicTrustRoute: async () => route(),
}));
vi.mock('../../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));

import { trustCatalog } from '../../i18n/trust';

const { default: CatalogPage } = await import('./page');
const { default: PackPage } = await import('./[packKey]/page');

const BENGALI = /[ঀ-৿]/;

const dates = { effectiveDate: null as string | null };

function route(): PublicTrustRoute {
  return {
    packKey: 'uk.standard-visitor',
    packName: 'UK Standard Visitor',
    jurisdiction: 'United Kingdom',
    route: 'Visit',
    purpose: 'Tourism',
    routeDescription: 'Short tourist stays.',
    version: 3,
    effectiveDate: dates.effectiveDate,
    nextReviewDate: '2027-01-15',
    officialFee: null,
    officialChannelName: 'UK Visas and Immigration',
    officialChannelUrl: 'https://www.gov.uk/apply-uk-visa',
    officialReportingUrl: null,
    officialSources: [],
  } as unknown as PublicTrustRoute;
}

async function render(locale: 'en' | 'bn', which: 'catalog' | 'pack') {
  current.locale = locale;
  current.generation += 1;
  const element =
    which === 'catalog'
      ? CatalogPage({ searchParams: Promise.resolve({}) })
      : PackPage({ params: Promise.resolve({ packKey: 'uk.standard-visitor' }) });
  return textOf(await renderServer(element));
}

describe('the public trust pages under Bengali', () => {
  it('shows Bengali for the trust story and the pack chrome, never a raw key or placeholder', async () => {
    const catalog = await render('bn', 'catalog');
    expect(catalog).toContain(trustCatalog.bn['trust.publicTrustStory.theTrustModel']);
    expect(catalog).toContain(trustCatalog.bn['trust.publicTrustStory.yourRecords']);
    const pack = await render('bn', 'pack');
    expect(pack).toMatch(BENGALI);
    expect(pack).toContain(trustCatalog.bn['trust.trustPackkeyPage.route']);
    for (const text of [catalog, pack]) {
      expect(text).not.toMatch(/trust\.(trustPackkeyPage|publicTrustStory|trustUnavailable)\./);
      expect(text).not.toMatch(/\{[A-Za-z]+\}/);
    }
    // Pack data (names, channels) is data, not wording, and stays as stored.
    expect(pack).toContain('UK Standard Visitor');
    expect(pack).toContain('UK Visas and Immigration');
  });

  it('keeps the disclaimer, privacy claim and verification status in English', async () => {
    const catalog = await render('bn', 'catalog');
    const pack = await render('bn', 'pack');
    for (const key of [
      'trust.publicTrustStory.clearBoundariesHumanControlNoApproval',
      'trust.publicTrustStory.privateByDesign',
    ] as const) {
      expect(key in trustCatalog.bn, key).toBe(false);
      expect(catalog, key).toContain(trustCatalog.en[key]);
    }
    for (const key of [
      'trust.trustPackkeyPage.officialChannel',
      'trust.trustPackkeyPage.notCurrentlyVerified',
    ] as const) {
      expect(key in trustCatalog.bn, key).toBe(false);
    }
    expect(pack).toContain(trustCatalog.en['trust.trustPackkeyPage.officialChannel']);
  });

  it('writes the route dates for a Bengali reader, and keeps the English format for English', async () => {
    dates.effectiveDate = '2026-11-12';
    try {
      const bn = await render('bn', 'pack');
      // 15 January 2027 and 12 November 2026, with Bengali digits and month names.
      expect(bn).toContain('পরবর্তী পর্যালোচনা ১৫ জানু, ২০২৭');
      expect(bn).toContain('১২ নভে, ২০২৬');
      expect(bn).not.toMatch(/Jan 15, 2027|Nov 12, 2026/);
      const en = await render('en', 'pack');
      expect(en).toContain('Next reviewed Jan 15, 2027');
      expect(en).toContain('In effect since Nov 12, 2026');
    } finally {
      dates.effectiveDate = null;
    }
  });

  it('keeps every fee, requirement and official-process sentence English (not in the Bengali catalogue)', () => {
    for (const key of Object.keys(trustCatalog.en)) {
      if (
        /officialFee|whatTheGovernmentCharges|theOfficialGovernmentFee|weDoNotShowAFee|whereToActuallyApply|thisPageDescribesTheOfficialProcess|theOnlyChannelThatActuallyDecides/.test(
          key,
        )
      )
        expect(key in trustCatalog.bn, key).toBe(false);
    }
  });

  it('has no raw placeholder in any Bengali string', () => {
    for (const [key, value] of Object.entries(trustCatalog.bn))
      expect(value.replace(/\{[A-Za-z]+\}/g, ''), key).not.toMatch(/[{}]/);
  });
});

describe('the public trust pages under English', () => {
  it('render the original English with no Bengali', async () => {
    const catalog = await render('en', 'catalog');
    expect(catalog).toContain('The Trust Model');
    expect(catalog).not.toMatch(BENGALI);
    const pack = await render('en', 'pack');
    expect(pack).toContain('Scam Awareness');
    expect(pack).not.toMatch(BENGALI);
  });
});
