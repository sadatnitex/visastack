import { DESTINATIONS } from '@visastack/core/destinations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';

/**
 * WP-PUB4: the public Countries page. Built only from the sourced destination catalogue (public,
 * no sign-in): 12 rows, then Show More through a bounded `?show=` link that works without script.
 */

const signedIn = vi.hoisted(() => ({ value: false }));
vi.mock('../../lib/signed-in', () => ({ isSignedIn: async () => signedIn.value }));

const { default: CountriesPage, metadata } = await import('./page');
const { COUNTRIES_STEP, sourceLabel } = await import('./countries-data');
const { needsChecking, isUnofficial } = await import('../../lib/country-view');
const { tonesAlternate } = await import('../../components/public-site/scene');
const { startHrefForCountry, appHrefForCountry } = await import('../../lib/country-start-links');

const TOTAL = DESTINATIONS.length;
const render = (params: Record<string, string | string[]> = {}) =>
  renderServer(CountriesPage({ searchParams: Promise.resolve(params) }));
const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll("'", '&#x27;')
    .replaceAll('"', '&quot;');
const rows = (html: string) => html.match(/data-country-row="[A-Z]{2}"/g) ?? [];

beforeEach(() => {
  signedIn.value = false;
});

describe('the public Countries page', () => {
  it('is titled Countries and Sources', () => {
    expect(metadata).toEqual({ title: 'Countries and Sources' });
  });

  it('has exactly one h1 and it is the first heading', async () => {
    const html = await render();
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html.match(/<h[1-6][ >]/)?.[0]).toBe('<h1 ');
  });

  it('shows 12 rows first, with the count line and a Show More link', async () => {
    const html = await render();
    expect(COUNTRIES_STEP).toBe(12);
    expect(rows(html)).toHaveLength(12);
    expect(html).toContain(`Showing 12 of ${TOTAL} countries.`);
    expect(html).toMatch(/href="\/countries\?show=24#[^"]+"/);
  });

  it('grows by 12 with ?show= and reaches the end, where the link goes away', async () => {
    expect(rows(await render({ show: '24' }))).toHaveLength(24);
    const all = await render({ show: String(TOTAL) });
    expect(rows(all)).toHaveLength(TOTAL);
    expect(all).toContain(`Showing all ${TOTAL} countries.`);
    expect(all).not.toContain('Show More');
  });

  it.each(['abc', '-5', '0', '1e9', '99999999999', '12.5', ''])(
    'never errors on a hand-edited show value (%s)',
    async (show) => {
      const count = rows(await render({ show })).length;
      expect(count).toBeGreaterThanOrEqual(12);
      expect(count).toBeLessThanOrEqual(TOTAL);
      expect(count % 12 === 0 || count === TOTAL).toBe(true);
    },
  );

  it('keeps the first value of a repeated show parameter', async () => {
    expect(rows(await render({ show: ['24', '48'] }))).toHaveLength(24);
  });

  const rowOf = (html: string, iso2: string) =>
    html.split(`data-country-row="${iso2}"`)[1]?.split('data-country-row=')[0] ?? '';
  const day = (date: string) =>
    new Date(date).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  it('shows each row with a flag, its name, the source shown and the date of that source', async () => {
    const html = await render({ show: String(TOTAL) });
    for (const d of DESTINATIONS.filter((x) => x.researched)) {
      const row = rowOf(html, d.iso2);
      expect(row, d.country).toContain(escapeHtml(d.country));
      expect(row, d.country).toMatch(/\/flags\/[a-z]{2}\.svg|pub4c-flag-none/);
      const label = sourceLabel(d.source);
      expect(row, d.country).toContain(
        label === null ? 'No Source Given' : `Source: ${escapeHtml(label)}`,
      );
      expect(row, d.country).toContain(
        d.source?.checkedOn ? `Checked On ${day(d.source.checkedOn)}` : 'Date Not Recorded',
      );
    }
  });

  it('names a source that has an address but no title or publisher by its host', async () => {
    const html = await render({ show: String(TOTAL) });
    expect(rowOf(html, 'KR')).toContain('Source: overseas.mofa.go.kr');
    expect(rowOf(html, 'KR')).not.toContain('No Source Given');
    expect(rowOf(html, 'VN')).toContain('Source: evisa.gov.vn');
    expect(rowOf(html, 'VN')).not.toContain('No Source Given');
  });

  it('shows the same warnings as the signed-in list on every row that needs them', async () => {
    const html = await render({ show: String(TOTAL) });
    const unofficial = DESTINATIONS.filter((d) => d.researched && isUnofficial(d.source));
    const check = DESTINATIONS.filter((d) => d.researched && needsChecking(d.source));
    expect(unofficial.length).toBeGreaterThan(0);
    expect(check.length).toBeGreaterThan(0);
    for (const d of unofficial)
      expect(rowOf(html, d.iso2), d.country).toContain('Not from an official page.');
    for (const d of check)
      expect(rowOf(html, d.iso2), d.country).toContain('Needs checking before you rely on it.');
    for (const d of DESTINATIONS.filter(
      (x) => x.researched && !isUnofficial(x.source) && !needsChecking(x.source),
    ))
      expect(rowOf(html, d.iso2), d.country).not.toMatch(
        /Not from an official page|Needs checking/,
      );
  });

  it('says Not Researched Yet, with no date, for a country with no stated facts', async () => {
    const html = await render({ show: String(TOTAL) });
    const unresearched = DESTINATIONS.filter((d) => !d.researched);
    expect(unresearched.length).toBeGreaterThan(0);
    for (const d of unresearched) {
      const row =
        html.split(`data-country-row="${d.iso2}"`)[1]?.split('data-country-row=')[0] ?? '';
      expect(row, d.country).toContain('Not Researched Yet');
      expect(row, d.country).not.toMatch(/Checked On/);
    }
  });

  it('starts a visitor through sign-up or sign-in, and a signed-in person straight to the app', async () => {
    const first = DESTINATIONS[0]?.iso2 ?? '';
    const visitor = await render({ show: String(TOTAL) });
    expect(visitor).toContain(startHrefForCountry(first, false).replaceAll('&', '&amp;'));
    signedIn.value = true;
    const member = await render({ show: String(TOTAL) });
    expect(member).toContain(appHrefForCountry(first));
  });

  it('alternates dark and light chapters and keeps the flag ring to 12 flags', async () => {
    const html = await render();
    const tones = [...html.matchAll(/data-tone="(dark|light)"/g)].map(
      (m) => m[1] as 'dark' | 'light',
    );
    expect(tones.length).toBeGreaterThanOrEqual(3);
    expect(tonesAlternate(tones)).toBe(true);
    const ring = html.split('pub-flag-ring-list')[1]?.split('</ul>')[0] ?? '';
    const flags = ring.match(/<li /g) ?? [];
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.length).toBeLessThanOrEqual(12);
  });

  it('uses no inline style, no data picture and no em dash', async () => {
    const html = await render({ show: String(TOTAL) });
    expect(html).not.toMatch(/ style="/);
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('blob:');
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });
});
