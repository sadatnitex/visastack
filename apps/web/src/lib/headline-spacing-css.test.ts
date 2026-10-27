import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Homepage headline legibility (Growth G1b). At -0.073em the "c" and "l" of "clean" touched and read
 * as a "d". Every rule that sets the headline spacing, desktop and phone, must stay at or above
 * the limit below, and the heavy weight stays so the look stays calm and strong.
 */
const css = readFileSync(join(__dirname, '..', 'app', 'landing-c1.css'), 'utf8');

/** The tightest spacing allowed, in em. The shipped value is -0.04em. */
const TIGHTEST_EM = -0.045;

const declarations = [...css.matchAll(/\.c1 \.c1-headline \{([^}]*)\}/g)].map((m) => m[1] ?? '');
const spacings = declarations.flatMap((body) =>
  [...body.matchAll(/letter-spacing:\s*(-?[0-9.]+)em/g)].map((m) => Number(m[1])),
);

describe('homepage headline spacing', () => {
  it('sets spacing in the desktop rule and in the phone rule', () => {
    expect(spacings.length).toBeGreaterThanOrEqual(2);
  });

  it('is never tighter than the limit', () => {
    for (const value of spacings) {
      expect(value).toBeGreaterThanOrEqual(TIGHTEST_EM);
    }
  });

  it('is never set in a unit that would escape the check', () => {
    for (const body of declarations) {
      expect(body).not.toMatch(/letter-spacing:\s*-?[0-9.]+(px|rem|%)/);
    }
  });

  it('keeps the heavy weight', () => {
    const weights = declarations.flatMap((b) =>
      [...b.matchAll(/font-weight:\s*(\d+)/g)].map((m) => Number(m[1])),
    );
    expect(Math.max(...weights)).toBeGreaterThanOrEqual(780);
  });
});
