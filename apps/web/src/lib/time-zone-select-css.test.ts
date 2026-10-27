import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const start = css.indexOf('/* WP-TZ ');
const end = css.indexOf('/* WP-', start + 1);
const block = css.slice(start, end);

describe('the time zone dropdown style block (WP-TZ)', () => {
  it('is one block, found by its marker', () => {
    expect(css.split('/* WP-TZ ').length).toBe(2);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it('is flat and uses no literal colours', () => {
    expect(block).not.toMatch(/box-shadow|gradient|backdrop-filter|rgba?\(|#[0-9a-fA-F]{3,8}\b/);
  });

  it('is wide enough to read "(UTC+06:00) Dhaka" and takes the whole row on a phone', () => {
    expect(block).toMatch(/\.tz-select \{[^}]*min-width: min\(15rem, 100%\)/);
    expect(block).toMatch(/@media \(max-width: 480px\) \{\s*\.tz-select \{[^}]*flex-basis: 100%/);
  });

  it('never shrinks the shared control height', () => {
    expect(block).not.toMatch(/(^|[^-])height:/);
  });
});
