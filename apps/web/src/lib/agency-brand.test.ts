import { describe, expect, it } from 'vitest';
import { agencyBrand, contrast, initialsOf, luminance, readableOn, tintOf } from './agency-brand';

describe('the letters of an agency mark', () => {
  it('takes the first letters of the first two words, or two letters of a single word', () => {
    expect(initialsOf('Travel Router')).toBe('TR');
    expect(initialsOf('Skyline')).toBe('SK');
    expect(initialsOf('  global   mobility  studio ')).toBe('GM');
    expect(initialsOf('Obsidian-Global & Co')).toBe('OG');
    expect(initialsOf('A')).toBe('A');
  });

  it('copes with names that hold no letters and with letters outside English', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('123 !!')).toBe('?');
    expect(initialsOf('ভিসা স্ট্যাক')).toHaveLength(2);
  });
});

describe('colours that stay readable', () => {
  it('measures contrast the WCAG way', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('puts white on a dark accent and the product ink on a light one, always at 4.5 or better', () => {
    for (const accent of [
      '#087a68',
      '#1a73e8',
      '#7a1f1f',
      '#f5c518',
      '#ffd400',
      '#a8e6cf',
      '#ff7a00',
    ]) {
      const text = readableOn(accent);
      expect(contrast(accent, text), accent).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableOn('#087a68')).toBe('#ffffff');
    expect(readableOn('#ffd400')).toBe('#152b37');
  });

  it('mixes an accent into white for a quiet background', () => {
    expect(tintOf('#000000', 0.12)).toBe('#e0e0e0');
    expect(tintOf('#087a68', 0)).toBe('#ffffff');
    expect(tintOf('#087a68', 1)).toBe('#087a68');
  });
});

describe('the whole brand', () => {
  it('works out everything from a name, an accent and a logo', () => {
    const brand = agencyBrand({
      name: 'Travel Router',
      accentColor: '#087A68',
      logoUrl: '/api/branding/logo/x?v=1',
    });
    expect(brand).toEqual({
      name: 'Travel Router',
      initials: 'TR',
      accent: '#087a68',
      onAccent: '#ffffff',
      tint: tintOf('#087a68', 0.12),
      logoUrl: '/api/branding/logo/x?v=1',
    });
  });

  it('has no accent colours when none is set or the value is not a six-digit colour', () => {
    for (const accentColor of [null, '', 'red', '#fff', '#12345g']) {
      const brand = agencyBrand({ name: 'Skyline', accentColor, logoUrl: null });
      expect(brand.accent).toBeNull();
      expect(brand.tint).toBeNull();
      expect(brand.onAccent).toBe('#152b37');
    }
  });
});
