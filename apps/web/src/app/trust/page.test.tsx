// @vitest-environment jsdom
import type { PublicTrustRoute } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

/**
 * WP-SB8 scroll budget: the public route list shows 12 routes, then a Show More link that adds 12
 * at a time and reaches every route, and a search once there are more than 12. Both are plain
 * links and a plain form, so they work without script.
 */

const listPublicTrustPublished = vi.fn();
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listPublicTrustPublished: (...args: unknown[]) => listPublicTrustPublished(...args),
}));
vi.mock('../../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));

const { default: PublicTrustCatalogPage, metadata } = await import('./page');

function route(n: number): PublicTrustRoute {
  return {
    packKey: `route-${n}`,
    packName: `Route Number ${String(n).padStart(3, '0')}`,
    jurisdiction: n === 150 ? 'Japan' : 'United Kingdom',
    route: 'Visit',
    purpose: 'Tourism',
    routeDescription: 'Short tourist stays.',
    version: 1,
    effectiveDate: null,
    nextReviewDate: null,
    officialFee: null,
    officialChannelName: null,
    officialChannelUrl: null,
    officialReportingUrl: null,
    officialSources: [],
  } as PublicTrustRoute;
}

const routes = (count: number) => Array.from({ length: count }, (_, n) => route(n));
const render = (params: Record<string, string> = {}) =>
  renderServer(PublicTrustCatalogPage({ searchParams: Promise.resolve(params) }));
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const cards = (html: string) => html.match(/<a href="\/trust\/route-\d+" class="card"/g) ?? [];

beforeEach(() => {
  listPublicTrustPublished.mockReset();
});

describe('the public route list', () => {
  it('shows 12 of 156 routes with a Show More link that keeps the search and lands on the next route', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(156));
    const html = await render();
    expect(cards(html)).toHaveLength(12);
    expect(textOf(html)).toContain('Showing 12 of 156 routes.');
    expect(html).toContain('href="/trust?show=24#trust-route-12"');
    expect(html).toContain('id="trust-route-11"');
    // More than 12 routes, so the search is offered, as a plain form that needs no script.
    const form = parse(html).querySelector('form.trust-search');
    expect(form?.getAttribute('action')).toBe('/trust#today');
    expect(form?.getAttribute('method')).toBe('get');
    expect(form?.querySelector('input[name="q"]')).not.toBeNull();
  });

  it('reaches every route by Show More alone, past the 100 a capped list would stop at', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(156));
    const html = await render({ show: '156' });
    expect(cards(html)).toHaveLength(156);
    expect(textOf(html)).toContain('Showing all 156 routes.');
    expect(html).not.toContain('Show More');
  });

  it('searches the whole list, keeps the words in the next link and offers a way back', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(156));
    const japan = await render({ q: 'japan' });
    expect(cards(japan)).toEqual([expect.stringContaining('href="/trust/route-150"')]);
    expect(textOf(japan)).toContain('Showing the only route.');
    expect(japan).toContain('value="japan"');
    expect(japan).toContain('href="/trust#today">Clear Search');
    const page = await render({ q: 'route number 1', show: '12' });
    expect(page).toContain('href="/trust?q=route+number+1&amp;show=24#trust-route-12"');
    const none = await render({ q: 'atlantis' });
    expect(cards(none)).toHaveLength(0);
    expect(textOf(none)).toContain('No routes match your search.');
  });

  it('treats a malformed or huge show value as the first step or the whole list, never an error', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(30));
    expect(cards(await render({ show: 'abc' }))).toHaveLength(12);
    expect(cards(await render({ show: '-5' }))).toHaveLength(12);
    expect(cards(await render({ show: '999999' }))).toHaveLength(30);
  });

  it('keeps a short list plain: no search and no Show More for 12 routes or fewer', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(12));
    const html = await render();
    expect(cards(html)).toHaveLength(12);
    expect(html).not.toContain('trust-search');
    expect(html).not.toContain('Show More');
    expect(textOf(html)).toContain('Showing all 12 routes.');
  });

  it('still works when called without an address, as the older checks do', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(3));
    expect(cards(await renderServer(PublicTrustCatalogPage()))).toHaveLength(3);
  });
});

/**
 * WP-PUB3: the trust page opens on a timed share sheet (switches, then Access Ended). The route
 * list below it keeps every behaviour above, and the page stays readable when the database is down.
 */
describe('the Privacy and Trust story', () => {
  it('is named Privacy and Trust and keeps one top heading with its id', async () => {
    expect(metadata.title).toBe('Privacy and Trust');
    listPublicTrustPublished.mockResolvedValue(routes(3));
    const html = await render();
    expect(parse(html).querySelectorAll('h1')).toHaveLength(1);
    expect(html).toContain('id="trust-story-title"');
  });

  it('shows the timed share sheet finished without script: Saved is not Shared, then Access Ended', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(3));
    const html = await render();
    expect(html).toContain('Share with Agency');
    expect(textOf(html)).toContain('Access Ended');
    expect(textOf(html)).toContain('Not Shared');
    expect(parse(html).querySelectorAll('.pub-example').length).toBeGreaterThanOrEqual(1);
  });

  it('runs the chapters in the order of tones the reference shows', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(3));
    const html = await render();
    const tones = [...parse(html).querySelectorAll('.pub-chapter')].map((chapter) =>
      chapter.getAttribute('data-tone'),
    );
    // The reference runs dark, dark, dark, light, light, dark (R3 records): never light then dark then light.
    expect(tones).toEqual(['dark', 'dark', 'dark', 'light', 'light', 'dark']);
  });

  it('keeps the route cards linked to their pack pages next to the story', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(3));
    const html = await render();
    expect(html).toContain('href="/trust/route-0"');
    expect(html).toContain('Maintained Route Information');
  });

  it('says so plainly, under the story, when the database is down', async () => {
    listPublicTrustPublished.mockRejectedValue(new Error('synthetic outage'));
    const html = await render();
    expect(html).toContain('id="trust-story-title"');
    expect(textOf(html)).toContain('Route Information Is Not Available Right Now');
    expect(html).not.toContain('href="/trust/route-');
  });

  it('has no em dash', async () => {
    listPublicTrustPublished.mockResolvedValue(routes(3));
    expect(await render()).not.toContain('\u2014');
  });
});
