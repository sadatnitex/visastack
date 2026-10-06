import type { PublicTrustRoute } from '@visastack/services';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './axe.test-support';
import './next-mocks.test-support';

/**
 * Whole pages, in the site shell a visitor really gets (skip link, pilot banner, header
 * and navigation, the page, footer), checked as pages: exactly one main landmark, exactly
 * one top heading, a skip link that goes somewhere, every part of the page inside a
 * landmark, and everything the component-level scan checks.
 *
 * The data behind each page is simulated. What this cannot see (colour contrast, layout,
 * how a screen reader reads the page) is not claimed.
 */

const session = vi.hoisted(() => ({ user: null as null | { email: string } }));
const trust = vi.hoisted(() => ({
  routes: [] as unknown[],
  route: undefined as unknown,
  down: false,
}));

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: async () => ({ user: session.user }),
}));
vi.mock('./locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../app/actions', () => ({ setLocaleAction: async () => undefined }));
vi.mock('./public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listPublicTrustPublished: async () => {
    if (trust.down) throw new Error('database unreachable');
    return trust.routes;
  },
  getPublicTrustRoute: async () => {
    if (trust.down) throw new Error('database unreachable');
    return trust.route;
  },
}));

vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');

const { default: RootLayout } = await import('../app/layout');
const { default: HomePage } = await import('../app/page');
const { default: NotFound } = await import('../app/not-found');
const { default: AppError } = await import('../app/error');
const { default: GlobalError } = await import('../app/global-error');
const { default: PilotAccessDeniedPage } = await import('../app/pilot-access-denied/page');
const { StatusView } = await import('../app/status/status-view');
const { default: TrustCatalogPage } = await import('../app/trust/page');
const { default: TrustRoutePage } = await import('../app/trust/[packKey]/page');

type StatusProps = Parameters<typeof StatusView>[0];

const LIVE = { ok: true, status: 'live', data: { status: 'live' } };
const READY = {
  ok: true,
  status: 'ready',
  data: {
    status: 'ready',
    platform: {
      authentication: 'available',
      documentUpload: 'available',
      aiExtraction: 'unconfigured',
      malwareScanning: 'unconfigured',
      originalDownload: 'disabled',
      commercialClaims: 'disabled',
    },
  },
};
const status = (overrides: Partial<StatusProps> = {}): ReactElement => (
  <StatusView
    live={LIVE}
    ready={READY}
    updatedAt="14:05:09"
    loading={false}
    onRefresh={() => undefined}
    {...overrides}
  />
);

const ROUTE: PublicTrustRoute = {
  packKey: 'uk.standard-visitor',
  packName: 'UK Standard Visitor',
  jurisdiction: 'United Kingdom',
  route: 'Visit',
  purpose: 'Tourism',
  routeDescription: 'Short tourist stays.',
  version: 3,
  effectiveDate: new Date('2026-01-01T00:00:00Z'),
  nextReviewDate: new Date('2027-01-01T00:00:00Z'),
  officialFee: { minorUnits: 12700, currency: 'GBP' },
  officialChannelName: 'UK Visas and Immigration',
  officialChannelUrl: 'https://www.gov.uk/apply-uk-visa',
  officialReportingUrl: 'https://www.gov.uk/report-immigration-crime',
  officialSources: [
    {
      publisher: 'UK Home Office',
      sourceTitle: 'Standard Visitor visa',
      sourceUrl: 'https://www.gov.uk/standard-visitor',
    },
  ],
};

interface Page {
  readonly name: string;
  readonly build: () => Promise<ReactElement>;
  /** A page that brings its own document (the last-resort error page), so the site shell is not added. */
  readonly standalone?: boolean;
}

const PAGES: readonly Page[] = [
  { name: 'home', build: async () => await HomePage({ searchParams: Promise.resolve({}) }) },
  {
    name: 'home after a sign-in that did not complete',
    build: async () => await HomePage({ searchParams: Promise.resolve({ auth_error: 'ref-123' }) }),
  },
  { name: 'status: everything working', build: async () => status() },
  {
    name: 'status: some parts having problems',
    build: async () =>
      status({
        ready: {
          ok: false,
          status: 'degraded',
          data: { status: 'degraded', platform: READY.data.platform },
        },
      }),
  },
  {
    name: 'status: cannot reach the service',
    build: async () =>
      status({
        live: { ok: false, status: 'unreachable', data: {} },
        ready: { ok: false, status: 'unreachable', data: {} },
      }),
  },
  {
    name: 'status: still checking',
    build: async () => status({ live: null, ready: null, updatedAt: '', loading: true }),
  },
  {
    name: 'route information (some routes)',
    build: async () => {
      trust.routes = [
        ROUTE,
        { ...ROUTE, packKey: 'schengen.short-stay', packName: 'Schengen Short Stay' },
      ];
      return await TrustCatalogPage();
    },
  },
  {
    name: 'route information (none yet)',
    build: async () => {
      trust.routes = [];
      return await TrustCatalogPage();
    },
  },
  {
    name: 'one route',
    build: async () => {
      trust.route = ROUTE;
      return (await TrustRoutePage({
        params: Promise.resolve({ packKey: ROUTE.packKey }),
      })) as ReactElement;
    },
  },
  {
    name: 'one route (no fee, no channel on file)',
    build: async () => {
      trust.route = {
        ...ROUTE,
        officialFee: null,
        officialChannelUrl: null,
        officialReportingUrl: null,
        officialSources: [],
      };
      return (await TrustRoutePage({
        params: Promise.resolve({ packKey: ROUTE.packKey }),
      })) as ReactElement;
    },
  },
  {
    name: 'route information while the database is down',
    build: async () => {
      trust.down = true;
      return await TrustCatalogPage();
    },
  },
  {
    name: 'one route while the database is down',
    build: async () => {
      trust.down = true;
      return (await TrustRoutePage({
        params: Promise.resolve({ packKey: 'uk.standard-visitor' }),
      })) as ReactElement;
    },
  },
  { name: 'page not found', build: async () => <NotFound /> },
  {
    name: 'something went wrong',
    build: async () => (
      <AppError
        error={Object.assign(new Error('x'), { digest: '2154584171' })}
        reset={() => undefined}
      />
    ),
  },
  {
    name: 'something went wrong (no reference)',
    build: async () => <AppError error={new Error('x')} reset={() => undefined} />,
  },
  { name: 'invite-only (signed in)', build: async () => await PilotAccessDeniedPage() },
  {
    name: 'last-resort error page',
    build: async () => <GlobalError error={new Error('x')} reset={() => undefined} />,
    standalone: true,
  },
];

async function pageMarkup(page: Page): Promise<string> {
  const element = await page.build();
  return renderToStaticMarkup(page.standalone ? element : await RootLayout({ children: element }));
}

beforeEach(() => {
  session.user = null;
  trust.routes = [];
  trust.route = undefined;
  trust.down = false;
});

describe('every public page, as a whole page', () => {
  it.each(PAGES.map((p) => [p.name, p] as const))(
    '%s has no accessibility problems',
    async (_name, page) => {
      expect(await axeViolations(await pageMarkup(page), { wholePage: true })).toEqual([]);
    },
    30_000,
  );

  it('is also fine for a signed-in visitor (the nav shows the workspace link)', async () => {
    session.user = { email: 'traveller@example.com' };
    const html = await pageMarkup(PAGES[0] as Page);
    expect(html).toContain('>Workspace</a>');
    expect(await axeViolations(html, { wholePage: true })).toEqual([]);
  });

  it('says plainly that route information is unavailable when the database is down (not a crash, not a 404)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    trust.down = true;
    const html = renderToStaticMarkup(await TrustCatalogPage());
    expect(html).toContain('Route information is not available right now');
    expect(html).toContain('href="/trust"');
    expect(html).not.toContain('database unreachable');
    const route = renderToStaticMarkup(
      (await TrustRoutePage({
        params: Promise.resolve({ packKey: 'uk.standard-visitor' }),
      })) as ReactElement,
    );
    expect(route).toContain('Route information is not available right now');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('has a skip link that lands on the main content', async () => {
    const html = await pageMarkup(PAGES[0] as Page);
    expect(html).toContain('href="#main"');
    expect(html).toContain('<main id="main">');
  });

  it('names each landmark so a screen reader user can tell them apart', async () => {
    const html = await pageMarkup(PAGES[0] as Page);
    expect(html).toContain('<nav class="nav-links" aria-label="Site">');
  });
});
