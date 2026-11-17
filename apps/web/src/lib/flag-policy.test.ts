import { describe, expect, it } from 'vitest';
import { HIDDEN_FLAG_CODES, flagSrc } from './flag-policy';

describe('flagSrc', () => {
  it('gives the static path for a known code, in any case', () => {
    expect(flagSrc('BD')).toBe('/flags/bd.svg');
    expect(flagSrc(' jp ')).toBe('/flags/jp.svg');
  });

  it('gives nothing for a bad, unknown or missing code', () => {
    for (const bad of ['', 'B', 'BDX', '12', 'B1', '??', 'zz', null, undefined]) {
      expect(flagSrc(bad)).toBeNull();
    }
  });

  it('gives nothing for a code on the hide-list', () => {
    expect(flagSrc('bd', ['bd'])).toBeNull();
    expect(flagSrc('BD', ['bd'])).toBeNull();
    expect(flagSrc('jp', ['bd'])).toBe('/flags/jp.svg');
  });

  it('ships with an empty hide-list and never returns a data: or blob: address', () => {
    expect(HIDDEN_FLAG_CODES).toEqual([]);
    expect(flagSrc('bd')).not.toMatch(/^(data|blob):/);
  });
});
