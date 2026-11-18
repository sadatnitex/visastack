import { CANONICAL_CASE_STATES, LEGACY_ONLY_MISSION_STATES } from '@visastack/core';
import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';
import { CASE_STATUS } from '../../lib/status-words';

/**
 * WP-PUB3: the How It Works page tells the case story as one scroll story. Every stage word is the
 * product's own (status-words.ts), every drawn figure is tagged Example, and the page reads
 * complete without script.
 */

vi.mock('server-only', () => ({}));

const { default: HowItWorksPage, metadata } = await import('./page');
const { tonesAlternate } = await import('../../components/public-site/scene');

const render = async () => renderServer(await HowItWorksPage());
const STAGES = [
  'Getting Started',
  'Gathering Documents',
  'Being Checked',
  'Needs You',
  'Ready to Submit',
];

describe('the How It Works page', () => {
  it('does not promise a check by someone else (only the case owner moves a case on)', async () => {
    const html = await render();
    expect(html).toContain('You look over the case before it moves on.');
    expect(html).not.toContain('A person looks over the case.');
  });

  it('is named How It Works and has one top heading', async () => {
    expect(metadata.title).toBe('How It Works');
    const html = await render();
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it('reads the case stage words from the product, in order, never an invented stage', async () => {
    const product = new Set(Object.values(CASE_STATUS).map((status) => status.word));
    for (const word of STAGES) expect(product.has(word), word).toBe(true);
    const html = await render();
    const text = textOf(html);
    let at = -1;
    for (const word of STAGES) {
      const next = text.indexOf(word, at + 1);
      expect(next, word).toBeGreaterThan(at);
      at = next;
    }
  });

  it('draws only stages a new case can reach: each is in the core stage list, none is Submitted', () => {
    const reachable = CANONICAL_CASE_STATES.filter((state) => state !== 'SUBMITTED');
    const words = reachable.map((state) => CASE_STATUS[state].word);
    for (const word of STAGES) expect(words, word).toContain(word);
    expect(LEGACY_ONLY_MISSION_STATES).not.toContain('SUBMISSION_READY');
    expect(STAGES).not.toContain(CASE_STATUS.SUBMITTED.word);
  });

  it('puts the case line in one scene that already shows its finished step without script', async () => {
    const html = await render();
    expect(html).toMatch(/data-scene="case"[^>]*data-len="3"/);
    expect(html).toMatch(/data-scene="case"[^>]*data-steps="5"/);
    expect(html).toMatch(/data-scene="case"[^>]*data-step="4"/);
    expect(html).toContain('class="p3-stages"');
  });

  it('tags every drawn case and figure as an Example and says readiness is not approval', async () => {
    const html = await render();
    expect(html.match(/class="pub-example"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const text = textOf(html);
    expect(text).toContain('Completeness only. Not an approval.');
    expect(text).toContain('Suggested');
    expect(text).toContain('Confirmed');
    // Submitted is not a stage a case can reach yet, so it is not drawn.
    expect(text).not.toContain('Submitted');
    expect(text).not.toMatch(/\bApproved\b/);
  });

  it("alternates dark and light chapters and keeps today's button label and sign-in link", async () => {
    const html = await render();
    const tones = [...html.matchAll(/data-tone="(dark|light)"/g)].map(
      (m) => m[1] as 'dark' | 'light',
    );
    expect(tones.length).toBeGreaterThanOrEqual(3);
    expect(tonesAlternate(tones)).toBe(true);
    expect(html).toMatch(
      /<a class="pub-button pub-button-primary" href="\/app">[^<]*Start with Your Own Profile/,
    );
  });

  it('keeps the first screen short: the opening chapter holds at most 30 words', async () => {
    const html = await render();
    const first = html.split('</section>')[0] ?? '';
    expect(textOf(first).split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(30);
  });

  it('has no em dash', async () => {
    expect(await render()).not.toContain(String.fromCharCode(0x2014));
  });
});
