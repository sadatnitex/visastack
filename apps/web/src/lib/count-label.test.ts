import { describe, expect, it } from 'vitest';
import { countLabel } from './count-label';

describe('countLabel', () => {
  it('writes the number up to the cap and the cap with a plus above it', () => {
    expect(countLabel(1, 99)).toBe('1');
    expect(countLabel(99, 99)).toBe('99');
    expect(countLabel(100, 99)).toBe('99+');
    expect(countLabel(9, 9)).toBe('9');
    expect(countLabel(10, 9)).toBe('9+');
  });

  it('uses Latin digits under en and Bengali digits under bn, including the cap', () => {
    expect(countLabel(3, 99, 'en')).toBe('3');
    expect(countLabel(3, 99, 'bn')).toBe('৩');
    expect(countLabel(100, 99, 'en')).toBe('99+');
    expect(countLabel(100, 99, 'bn')).toBe('৯৯+');
    expect(countLabel(12, 99, 'bn')).toBe('১২');
  });
});
