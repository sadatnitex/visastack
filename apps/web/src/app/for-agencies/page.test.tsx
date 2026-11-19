import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';

/**
 * WP-PUB4: the public For Agencies page. Invite-only as today; no logos, counts, testimonials,
 * ratings or partner names; every illustrative figure tagged Example; today's button labels.
 */

const state = vi.hoisted(() => ({ signedIn: false, beta: false, realData: false }));
vi.mock('../../lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('../../lib/public-beta', () => ({ isPublicBetaOpen: () => state.beta }));
vi.mock('../../lib/real-data-wording', () => ({
  realDataOpen: () => state.realData,
  ownDetailsWelcome: () => state.beta || state.realData,
}));
vi.mock('server-only', () => ({}));

const { default: ForAgenciesPage, metadata } = await import('./page');
const { homeCatalog } = await import('../../i18n/home');
const { documentPicture } = await import('../../lib/document-picture');
const { DESK_CARDS } = await import('./for-agencies-data');

const render = () => renderServer(ForAgenciesPage());
const parse = async () => new JSDOM(await render()).window.document;
const words = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  state.signedIn = false;
  state.beta = false;
  state.realData = false;
});

describe('the public For Agencies page', () => {
  it('is titled For Agencies', () => {
    expect(metadata).toEqual({ title: 'For Agencies' });
  });

  it('has exactly one h1 and it is the first heading', async () => {
    const html = await render();
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html.match(/<h[1-6][ >]/)?.[0]).toBe('<h1 ');
  });

  it("keeps today's invite-only wording and button labels", async () => {
    const closed = await render();
    expect(closed).toContain('Invite-Only Pilot');
    expect(closed).toContain('Sign in to get started');
    expect(closed).toContain('href="/app"');
    expect(closed).toContain('See What Works Today');
    expect(closed).toContain('href="/status"');
    state.beta = true;
    const open = await render();
    expect(open).toContain('Free Public Beta');
    expect(open).toContain('Create your free account');
    expect(open).toContain('href="/auth/sign-up"');
    state.signedIn = true;
    expect(await render()).toContain('Open your workspace');
  });

  it('reads its button words from the same catalogue entries as Home', async () => {
    const en = homeCatalog.en as Record<string, string>;
    expect(await render()).toContain(en['home.page.signInToGetStarted']);
    state.beta = true;
    expect(await render()).toContain(en['home.page.createYourFreeAccount']);
    state.signedIn = true;
    expect(await render()).toContain(en['home.page.openYourWorkspace']);
  });

  it('shows no logos, counts, testimonials, ratings or partner names', async () => {
    const html = await render();
    // Flags and the passport cover are self-hosted pictures; nothing comes from another origin.
    for (const src of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) expect(src[1]).toMatch(/^\//);
    expect(html).not.toMatch(/testimonial|trusted by|rated|stars?\b|partners?\b|customers?\b/i);
    expect(html).not.toMatch(/\b\d[\d,]*\+?\s+(agencies|clients|travellers|cases|countries)\b/i);
  });

  it('follows the approved reference: hero, desk, Plans, closing band', async () => {
    const html = await render();
    const doc = await parse();
    const h2 = [...doc.querySelectorAll('h2')].map((el) => words(el));
    expect(h2).toEqual([
      'What Changes at Your Desk.',
      'Plans.',
      'Bring Your Clients. Skip the Chasing.',
    ]);
    expect(html).toContain('Clients Arrive');
    for (const old of [
      'Stop Chasing',
      'What an Agency Gets',
      'One Case, One Clear Line',
      'You See Only What Is Shared',
      'One Traveller Profile',
    ])
      expect(html).not.toContain(old);
    for (const name of ['Aisha K.', 'Rafi H.', 'Nadia S.']) expect(html).toContain(name);
  });

  it('states Plans truthfully: no price, no tier, no invented offer', async () => {
    const closed = await render();
    expect(closed).toContain('Pricing is shown here when selling opens.');
    expect(closed).toContain('by invitation while we test with practice records');
    state.beta = true;
    expect(await render()).toContain('Accounts are free during the public beta.');
    // Owner, 19 Nov 2026: with real personal data on, no practice-record words even when closed.
    state.beta = false;
    state.realData = true;
    const invited = await render();
    expect(invited).toContain('Agency access is by invitation.');
    expect(invited).not.toContain('practice records');
    expect(closed).not.toMatch(
      /[$\u00a3\u20ac]\s?\d|\bper (month|seat|user)\b|\b(starter|pro|enterprise)\b/i,
    );
  });

  it('tags the case list with Example and never claims approval', async () => {
    const doc = await parse();
    const table = doc.querySelector('figure.kit-cases');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('.pub-example')).toHaveLength(1);
    expect(table?.querySelectorAll('li.kit-case')).toHaveLength(3);
    expect(words(table?.querySelector('.kit-note'))).toContain(
      'Completeness only. Not an approval.',
    );
    expect(words(doc.body)).not.toMatch(/approved|guarantee|accepted/i);
  });

  it('draws the desk cards with real pictures, never the generic fallback', async () => {
    for (const card of DESK_CARDS) {
      const choice = documentPicture(card.picture);
      expect(choice.kind, card.title).toBe('picture');
      expect(choice.kind === 'picture' && choice.picture).not.toBe('file');
    }
    const doc = await parse();
    for (const article of doc.querySelectorAll('main article, article')) {
      if (!article.querySelector('.r5-card-picture')) continue;
      expect(article.querySelector('.r5-card-picture svg')).not.toBeNull();
    }
  });

  it('keeps the closing band on the real Bangladesh passport cover and its heading id', async () => {
    const doc = await parse();
    const band = doc.querySelector('section[aria-labelledby="closing-band-title"]');
    expect(band?.querySelector('#closing-band-title')?.tagName).toBe('H2');
    expect(band?.querySelector('img')?.getAttribute('src') ?? '').toMatch(/passport-bd/);
  });

  it('needs no scroll scenes: the page has none and starts no scroll engine', async () => {
    const html = await render();
    expect(html).not.toContain('pub-scene');
  });

  it('alternates dark and light chapters, uses no inline style and no em dash', async () => {
    const html = await render();
    const tones = [
      ...(await parse()).querySelectorAll('main section[data-tone], section[data-tone]'),
    ].map((el) => el.getAttribute('data-tone'));
    expect(tones).toEqual(['dark', 'light', 'light', 'dark']);
    // The reference shows the desk and Plans as two light bands; no dark chapter ever follows a dark one.
    expect(tones.some((tone, i) => i > 0 && tone === 'dark' && tones[i - 1] === 'dark')).toBe(
      false,
    );
    expect(html).not.toMatch(/ style="/);
    expect(html).not.toContain('data:image');
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });
});
