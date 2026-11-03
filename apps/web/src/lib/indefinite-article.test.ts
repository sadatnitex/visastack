import { describe, expect, it } from 'vitest';
import { withArticle } from './indefinite-article';

describe('UMPE G4: a or an before a kind', () => {
  it('reads by sound, not by the first letter', () => {
    expect(withArticle('Utility Bill')).toBe('a Utility Bill');
    expect(withArticle('UK Visa Application')).toBe('a UK Visa Application');
    expect(withArticle('ID Card')).toBe('an ID Card');
    expect(withArticle('Hotel or Stay Booking')).toBe('a Hotel or Stay Booking');
    expect(withArticle('Employment Letter')).toBe('an Employment Letter');
    expect(withArticle('Bank Statement')).toBe('a Bank Statement');
    expect(withArticle('Unclear Document')).toBe('an Unclear Document');
  });
});
