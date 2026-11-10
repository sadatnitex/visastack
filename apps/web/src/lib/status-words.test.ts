import { describe, expect, it } from 'vitest';
import { CHIP_WORDS, REQUEST_STATUS } from './status-words';
import { isTitleCase } from './title-case';

describe('the words on a request row', () => {
  it('are in the one chip vocabulary, in Title Case', () => {
    for (const { word } of Object.values(REQUEST_STATUS)) {
      expect(CHIP_WORDS.has(word), word).toBe(true);
      expect(isTitleCase(word), word).toBe(true);
    }
  });

  it('keep Received blue and never green; only Reviewed is green', () => {
    const named = (word: string) => Object.values(REQUEST_STATUS).find((s) => s.word === word);
    expect(named('Received')).toEqual({ word: 'Received', tone: 'info' });
    expect(named('Reviewed')).toEqual({ word: 'Reviewed', tone: 'success' });
    const green = Object.values(REQUEST_STATUS).filter((status) => status.tone === 'success');
    expect(green.map((status) => status.word)).toEqual(['Reviewed']);
  });
});
