import { MAX_EVIDENCE_REQUESTS_PER_SEND } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { parseAskItems } from './request-items';
import { MAX_ASK_ITEMS } from './request-picker-types';

describe('the items of one send', () => {
  it('the picker and the service agree on the most items one send may carry', () => {
    expect(MAX_ASK_ITEMS).toBe(MAX_EVIDENCE_REQUESTS_PER_SEND);
  });

  it('reads DOCUMENT and FIELD items, drops blanks, and asks for a repeated item once', () => {
    expect(parseAskItems(['DOCUMENT:NID', ' ', 'FIELD:passport_number', 'DOCUMENT:NID'])).toEqual({
      ok: true,
      items: [
        { kind: 'DOCUMENT', key: 'NID' },
        { kind: 'FIELD', key: 'passport_number' },
      ],
    });
  });

  it('keeps a colon inside the key', () => {
    expect(parseAskItems(['FIELD:a:b'])).toEqual({
      ok: true,
      items: [{ kind: 'FIELD', key: 'a:b' }],
    });
  });

  it('refuses an empty send, a badly shaped item, and more than the cap, in plain words', () => {
    expect(parseAskItems([])).toEqual({ ok: false, message: 'Choose at least one item.' });
    for (const bad of ['NID', 'THING:NID', 'FIELD:', ':NID', 'document:NID']) {
      expect(parseAskItems([bad])).toEqual({
        ok: false,
        message: 'One of the items is not one we know. Choose from the list.',
      });
    }
    const many = Array.from({ length: MAX_ASK_ITEMS + 1 }, (_, i) => `DOCUMENT:K_${i}`);
    expect(parseAskItems(many)).toEqual({
      ok: false,
      message: `You can ask for up to ${MAX_ASK_ITEMS} items in one send.`,
    });
  });
});
