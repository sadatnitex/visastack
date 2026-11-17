import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PRINT_COVER_NOTE, PrintCover } from './print-cover';

const base = {
  name: 'Nusrat Jahan',
  destination: 'United Kingdom',
  referenceCode: 'C-7K2Q9M',
  preparedOn: '17 November 2026',
  readiness: { required: 14, satisfied: 12 },
} as const;

const html = (over: Partial<Parameters<typeof PrintCover>[0]> = {}) =>
  renderToStaticMarkup(<PrintCover {...base} {...over} />);

describe('the printed pack cover', () => {
  it('prints the name, the country name, the reference, the date and the counts', () => {
    const out = html();
    expect(out).toContain('Nusrat Jahan');
    expect(out).toContain('United Kingdom');
    expect(out).toContain('C-7K2Q9M');
    expect(out).toContain('17 November 2026');
    expect(out).toContain('12 of 14 items ready');
  });

  it('says it shows what is gathered, never that a visa will be approved', () => {
    expect(html()).toContain(PRINT_COVER_NOTE);
    expect(PRINT_COVER_NOTE).toBe(
      'This shows what is gathered, not whether a visa will be approved.',
    );
  });

  it('draws the flag as a same-site picture with the country name beside it', () => {
    const out = html();
    expect(out).toContain('src="/flags/gb.svg"');
    expect(out).not.toMatch(/src="(data|blob):/);
    expect(out).toContain('print-cover-country');
  });

  it('prints no flag for a place it does not know, and still prints the name', () => {
    const out = html({ destination: 'Somewhere Else' });
    expect(out).not.toContain('<img');
    expect(out).toContain('Somewhere Else');
  });

  it('prints no counts line, never a zero, when there is no checklist', () => {
    const out = html({ readiness: null });
    expect(out).not.toContain('ready');
    expect(out).not.toContain('0 of');
    expect(html({ readiness: { required: 0, satisfied: 0 } })).not.toContain('0 of');
  });

  it('leaves out a missing reference code and a missing place', () => {
    const out = html({ referenceCode: null, destination: null });
    expect(out).not.toContain('Case Reference');
    expect(out).not.toContain('print-cover-place');
  });

  it('uses a singular for one item', () => {
    expect(html({ readiness: { required: 1, satisfied: 1 } })).toContain('1 of 1 item ready');
  });
});

describe('the printed cover styles', () => {
  const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
  const start = css.indexOf('/* WP-PIC13 printed pack cover');
  const end = css.indexOf('/* end WP-PIC13 */');
  const block = css.slice(start, end);

  it('is one block placed before the Documents stack block', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(css.indexOf('/* WP-PIC5')).toBeGreaterThan(end);
    expect(css.indexOf('/* WP-PIC13', start + 1)).toBe(-1);
  });

  it('hides the cover on screen and shows it only in print, then starts a new page', () => {
    expect(block).toMatch(/\.print-cover\s*\{\s*display:\s*none;/);
    expect(block).toMatch(/@media print\s*\{[\s\S]*\.print-cover\s*\{[\s\S]*display:\s*flex/);
    expect(block).toContain('break-after: page');
  });

  it('relies on no colour: only black and white, a grey flag and an outline', () => {
    const colours = block.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|var\(--/g) ?? [];
    expect(colours.filter((c) => c !== '#000' && c !== '#fff')).toEqual([]);
    expect(block).toContain('grayscale(1)');
    expect(block).toMatch(/\.print-cover-flag\s*\{[^}]*border:\s*2px solid #000/);
  });
});
