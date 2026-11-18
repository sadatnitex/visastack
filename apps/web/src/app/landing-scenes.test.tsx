import { describe, expect, it, vi } from 'vitest';
import { tonesAlternate } from '../components/public-site/scene';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

const betaState = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => betaState.value }));

const signedInState = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => signedInState.value }));

const { default: HomePage } = await import('./page');

const render = async () => renderServer(HomePage({ searchParams: Promise.resolve({}) }));

/** The attribute values of every element carrying `attr`, in page order. */
function valuesOf(html: string, attr: string): string[] {
  return [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map((match) => match[1] ?? '');
}

describe('the home page scroll story (WP-PUB2)', () => {
  it('runs its scenes in the approved order: documents in, scan, Suggested, Confirmed, ring, passport', async () => {
    const html = await render();
    expect(valuesOf(html, 'data-scene')).toEqual(['intake', 'ready', 'closing']);
    // The first scene walks four steps: documents fly in, scan, Suggested, Confirmed.
    expect(html).toMatch(/data-scene="intake"[^>]*data-steps="4"/);
    const text = textOf(html);
    const order = ['Received', 'Suggested', 'Confirmed'].map((word) => text.indexOf(word));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('writes the finished step on every scene, so no JavaScript shows each one complete', async () => {
    const html = await render();
    expect(html).toMatch(/data-scene="intake"[^>]*data-step="3"/);
    expect(html).toMatch(/data-scene="ready"[^>]*data-step="1"/);
    expect(html).toMatch(/data-scene="closing"[^>]*data-step="0"/);
  });

  it('keeps the anchor ids other pages and links rely on', async () => {
    const html = await render();
    for (const id of ['how-it-works', 'for-agencies', 'start']) {
      expect(html.match(new RegExp(`id="${id}"`, 'g'))?.length, id).toBe(1);
    }
  });

  it('alternates dark and light chapters down the page', async () => {
    const html = await render();
    const tones = valuesOf(html, 'data-tone') as ('dark' | 'light')[];
    expect(tones.length).toBeGreaterThanOrEqual(3);
    expect(tonesAlternate(tones)).toBe(true);
  });

  it('tags every drawn figure as an example', async () => {
    const html = await render();
    const figures = html
      .split('<figure')
      .slice(1)
      .filter((part) => part.includes('land-draw'));
    expect(figures.length).toBeGreaterThanOrEqual(3);
    for (const figure of figures) {
      expect(figure.split('</figure>')[0], 'a drawn figure without the Example tag').toContain(
        'pub-example',
      );
    }
  });

  it('keeps today’s button labels and the invite-only wording', async () => {
    const html = await render();
    const text = textOf(html);
    expect(html).toMatch(/<a class="c1-pill" href="\/app">Sign in to get started/);
    expect(text).toContain('See What Works Today');
    expect(text).toContain('Invite-Only Pilot');
    // The closing scene offers the same main action as the hero, with the same label and address.
    expect(html).toMatch(
      /data-scene="closing"[\s\S]*?<a class="btn land-btn land-btn-light" href="\/app">Sign in to get started/,
    );
  });

  it('shows the ring with its exact caption: completeness, never approval', async () => {
    const html = await render();
    expect(textOf(html)).toContain('Completeness only. Not an approval.');
    expect(html).toMatch(/data-scene="ready"[\s\S]*Completeness only\. Not an approval\./);
  });

  it('says what a state means in its own word: Received is not Reviewed, Suggested is not Confirmed', async () => {
    const text = textOf(await render());
    expect(text).toContain('Suggested');
    expect(text).toContain('Confirmed');
    expect(text).not.toContain('Reviewed');
    expect(text).not.toMatch(/approved by|certified|guaranteed/i);
  });

  it('shows the real Bangladesh cover in the closing scene, sized and self hosted', async () => {
    const html = await render();
    expect(html).toMatch(/data-scene="closing"[\s\S]*?pub-passport-tilt/);
    expect(html).toContain('/pictures/passport-bd.png');
    expect(html).not.toMatch(/src="(?:data:|blob:|https?:)/);
  });

  it('states no invented count, logo, testimonial or rating', async () => {
    const scenes = (await render()).split('data-scene="intake"').slice(1).join('');
    const text = textOf(scenes).toLowerCase();
    for (const banned of ['testimonial', 'rated', 'stars', 'trusted by', 'customers']) {
      expect(text, banned).not.toContain(banned);
    }
  });
});
