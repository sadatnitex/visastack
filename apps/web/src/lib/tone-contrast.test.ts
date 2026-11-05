import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The six tones (blue, green, amber, red, violet, teal) colour numbers, icons and tags across the
 * app (WP-PLAIN-TONE in globals.css). Each tone is a solid colour with its own pale ground, and
 * text uses it in two ways: the tone on its ground (a number, a tag) and white on the tone (an
 * icon tile). Both pairs must pass WCAG 2 AA for normal text (4.5:1) so a colour never makes a
 * number harder to read.
 */

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

function tones(): Record<string, { tone: string; ground: string }> {
  const found: Record<string, { tone: string; ground: string }> = {};
  const rule =
    /\[data-tone="([a-z]+)"\]\s*\{\s*--tone:\s*(#[0-9a-fA-F]{6});\s*--tone-bg:\s*(#[0-9a-fA-F]{6});/g;
  for (const match of css.matchAll(rule)) {
    const [, name, tone, ground] = match;
    if (name && tone && ground) found[name] = { tone, ground };
  }
  return found;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('the six tones', () => {
  const all = tones();

  it('are exactly blue, green, amber, red, violet and teal', () => {
    expect(Object.keys(all).sort()).toEqual(['amber', 'blue', 'green', 'red', 'teal', 'violet']);
  });

  for (const [name, { tone, ground }] of Object.entries(all)) {
    it(`${name}: the tone is readable on its own ground and white is readable on the tone`, () => {
      expect(contrast(tone, ground), `${tone} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#ffffff', tone), `white on ${tone}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: the tone is readable on the card white too (a number on a white card)`, () => {
      expect(contrast(tone, '#ffffff'), `${tone} on white`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('are used by the rules that paint them: the icon accent, the Documents tiles and the overview tiles', () => {
    for (const rule of [
      '.icon .icon-accent {',
      '.wallet-overview-strip button[data-tone] {',
      '.lift-tile[data-tone] {',
      '.insights-summary-item .insights-summary-value',
      '.row.activity-log-row {',
    ]) {
      expect(css, rule).toContain(rule);
    }
  });
});
