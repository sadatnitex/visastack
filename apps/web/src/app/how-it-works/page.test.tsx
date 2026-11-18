import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

/**
 * R2: the How It Works page rebuilt to the approved reference. Four chapters in a fixed order, the
 * old case story left out, every made-up figure tagged Example, readiness never an approval.
 */

vi.mock('server-only', () => ({}));

const { default: HowItWorksPage, metadata } = await import('./page');
const render = async () => renderServer(await HowItWorksPage());

describe('the How It Works page (R2)', () => {
  it('is named How It Works and has one top heading', async () => {
    expect(metadata.title).toBe('How It Works');
    const html = await render();
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it('opens with the four numbered steps in order', async () => {
    const html = await render();
    const first = html.split('</section>')[0] ?? '';
    const text = textOf(first);
    expect(text).toContain('How It Works.');
    let at = -1;
    for (const word of ['Add', 'Check', 'Prepare', 'Share']) {
      const next = text.indexOf(word, at + 1);
      expect(next, word).toBeGreaterThan(at);
      at = next;
    }
    expect(first.match(/class="hk-step-chip"/g)).toHaveLength(4);
  });

  it('runs four chapters: dark opening, light rows, light words band, dark closing', async () => {
    const html = await render();
    const tones = [...html.matchAll(/data-tone="(dark|light)"/g)].map((m) => m[1]);
    expect(tones).toEqual(['dark', 'light', 'light', 'dark']);
  });

  it('draws one row per step with the picture each step needs', async () => {
    const html = await render();
    expect(html.match(/class="hk-row"/g)).toHaveLength(4);
    expect(html).toContain('three suggested fields');
    expect(html).toContain('three confirmed fields');
    expect(html).toContain('A Germany checklist with 3 of 8 items ready');
    expect(html).toContain('3 of 8 Ready');
    expect(html).toContain('Share with Agency');
  });

  it('removes the old case story chapters', async () => {
    const text = textOf(await render());
    for (const gone of [
      'Your Case,',
      'Step by Step',
      'You Stay in Charge',
      'Ready When You Are',
      'Follow a Case',
    ]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it('turns each word tile on a button that tells its state, with the meaning in the page', async () => {
    const html = await render();
    expect(html.match(/<button[^>]*class="hk-flip"[^>]*aria-pressed="false"/g)).toHaveLength(4);
    const text = textOf(html);
    for (const part of [
      'Received',
      'is not Reviewed',
      'Suggested',
      'is not Confirmed',
      'Saved',
      'is not Shared',
      'Ready',
      'is not Approved',
      'No one has checked it yet.',
    ]) {
      expect(text, part).toContain(part);
    }
  });

  it('tags every drawn figure as an Example and says readiness is not approval', async () => {
    const html = await render();
    expect(html.match(/class="pub-example"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(textOf(html)).toContain('Completeness only. Not an approval.');
  });

  it('keeps the sign-in and trust links and the button label', async () => {
    const html = await render();
    expect(html).toMatch(
      /<a class="pub-button pub-button-primary" href="\/app">[^<]*Start with Your Own Profile/,
    );
    expect(html).toMatch(/href="\/trust"[^>]*>[^<]*Privacy and Trust/);
  });

  it('keeps the scroll runtime on the page', async () => {
    const { ScenesRuntime } = await import('../../components/public-site/scenes-runtime');
    expect(ScenesRuntime).toBeTypeOf('function');
  });

  it('has no em dash', async () => {
    expect(await render()).not.toContain(String.fromCharCode(0x2014));
  });
});
