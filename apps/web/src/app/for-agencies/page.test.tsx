import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';

/**
 * WP-PUB4: the public For Agencies page. Invite-only as today; no logos, counts, testimonials,
 * ratings or partner names; every illustrative figure tagged Example; today's button labels.
 */

const state = vi.hoisted(() => ({ signedIn: false, beta: false }));
vi.mock('../../lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('../../lib/public-beta', () => ({ isPublicBetaOpen: () => state.beta }));

const { default: ForAgenciesPage, metadata } = await import('./page');
const { tonesAlternate } = await import('../../components/public-site/scene');

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
    expect(closed).toContain('Sign In to Get Started');
    expect(closed).toContain('href="/app"');
    expect(closed).toContain('See What Works Today');
    expect(closed).toContain('href="/status"');
    state.beta = true;
    const open = await render();
    expect(open).toContain('Free Public Beta');
    expect(open).toContain('Create Your Free Account');
    expect(open).toContain('href="/auth/sign-up"');
    state.signedIn = true;
    expect(await render()).toContain('Open Your Workspace');
  });

  it('shows no logos, counts, testimonials, ratings or partner names', async () => {
    const html = await render();
    expect(html).not.toMatch(/<img/);
    expect(html).not.toMatch(/testimonial|trusted by|rated|stars?\b|partners?\b|customers?\b/i);
    expect(html).not.toMatch(/\b\d[\d,]*\+?\s+(agencies|clients|travellers|cases|countries)\b/i);
  });

  it('tags every illustrative figure with Example and never claims approval', async () => {
    const html = await render();
    expect(html).toContain('Completeness only. Not an approval.');
    // Every illustrative block (the case board, each card) carries its own Example tag.
    const blocks = html.split(/(?=<article|<div class="pub4a-board)/).slice(1);
    const figures = blocks.filter((block) => /pub-readiness|pub-chip/.test(block));
    expect(figures.length).toBeGreaterThanOrEqual(2);
    for (const block of figures) expect(block.slice(0, 400)).toContain('pub-example');
    expect(html).not.toMatch(/approved|guarantee|accepted/i);
  });

  it('alternates dark and light chapters, uses no inline style and no em dash', async () => {
    const html = await render();
    const tones = [...html.matchAll(/data-tone="(dark|light)"/g)].map(
      (m) => m[1] as 'dark' | 'light',
    );
    expect(tones.length).toBeGreaterThanOrEqual(5);
    expect(tonesAlternate(tones)).toBe(true);
    expect(html).not.toMatch(/ style="/);
    expect(html).not.toContain('data:image');
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });
});
