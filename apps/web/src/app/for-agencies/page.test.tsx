import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';

/**
 * WP-PUB4: the public For Agencies page. Invite-only as today; no logos, counts, testimonials,
 * ratings or partner names; every illustrative figure tagged Example; today's button labels.
 */

const state = vi.hoisted(() => ({ signedIn: false, beta: false }));
vi.mock('../../lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('../../lib/public-beta', () => ({ isPublicBetaOpen: () => state.beta }));
vi.mock('server-only', () => ({}));

const { default: ForAgenciesPage, metadata } = await import('./page');
const { homeCatalog } = await import('../../i18n/home');

const render = () => renderServer(ForAgenciesPage());

beforeEach(() => {
  state.signedIn = false;
  state.beta = false;
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
    const h2 = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) =>
      m[1]
        ?.replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
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
    expect(closed).not.toMatch(
      /[$\u00a3\u20ac]\s?\d|\bper (month|seat|user)\b|\b(starter|pro|enterprise)\b/i,
    );
  });

  it('tags the case list with Example and never claims approval', async () => {
    const html = await render();
    expect(html).toContain('Completeness only. Not an approval.');
    expect(html).toMatch(/r5-cases[\s\S]{0,400}pub-example/);
    expect(html).not.toMatch(/approved|guarantee|accepted/i);
  });

  it('alternates dark and light chapters, uses no inline style and no em dash', async () => {
    const html = await render();
    const tones = [...html.matchAll(/data-tone="(dark|light)"/g)].map(
      (m) => m[1] as 'dark' | 'light',
    );
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
