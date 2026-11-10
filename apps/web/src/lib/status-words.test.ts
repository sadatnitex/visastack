import { describe, expect, it } from 'vitest';
import { CLOSED_REQUEST_LABELS, REQUEST_ITEM_STATUS_LABELS } from './labels';
import { CHIP_WORDS } from './status-words';
import { isTitleCase } from './title-case';

describe('the words on a request row', () => {
  it('are the labels the agency summary uses, in the one chip vocabulary, in Title Case', () => {
    for (const word of [
      ...Object.values(REQUEST_ITEM_STATUS_LABELS),
      ...Object.values(CLOSED_REQUEST_LABELS),
    ]) {
      expect(CHIP_WORDS.has(word), word).toBe(true);
      expect(isTitleCase(word), word).toBe(true);
    }
  });
});
