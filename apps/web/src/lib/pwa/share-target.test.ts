import { describe, expect, it } from 'vitest';
import {
  EMPTY_INBOX,
  SHARE_ACCEPT,
  SHARE_MAX_FILES,
  isShareTargetSwitchOn,
  parseInbox,
  shareTargetEntry,
  sharedFileUrl,
} from './share-target';

describe('the share switch', () => {
  it('is on only for "on", trimmed, in any case', () => {
    const read = (value: string | undefined) => () => value;
    expect(isShareTargetSwitchOn(read('on'))).toBe(true);
    expect(isShareTargetSwitchOn(read(' ON '))).toBe(true);
    for (const value of [undefined, '', 'off', 'true', '1', 'yes', 'onn']) {
      expect(isShareTargetSwitchOn(read(value))).toBe(false);
    }
  });

  it('offers photos and PDFs only, never a kind that can run code', () => {
    expect(shareTargetEntry().params.files[0]?.accept).toEqual([...SHARE_ACCEPT]);
    expect(SHARE_ACCEPT.some((type) => /svg|html|xml|javascript/.test(type))).toBe(false);
  });
});

describe('reading the worker answer', () => {
  it('keeps well formed files of accepted kinds only', () => {
    const inbox = parseInbox({
      files: [
        { n: 0, name: 'a.jpg', type: 'image/jpeg', size: 10 },
        { n: 1, name: 'b.svg', type: 'image/svg+xml', size: 10 },
        { n: 'x', name: 'c.jpg', type: 'image/jpeg', size: 10 },
        null,
      ],
      dropped: 2,
      at: 5,
      token: 'ab'.repeat(16),
    });
    expect(inbox).toEqual({
      files: [{ n: 0, name: 'a.jpg', type: 'image/jpeg', size: 10 }],
      dropped: 2,
      at: 5,
      token: 'ab'.repeat(16),
    });
  });

  it('never lists more than the inbox holds', () => {
    const files = Array.from({ length: SHARE_MAX_FILES + 5 }, (_, n) => ({
      n,
      name: `${n}.jpg`,
      type: 'image/jpeg',
      size: 1,
    }));
    expect(parseInbox({ files, token: 'cd'.repeat(16) }).files).toHaveLength(SHARE_MAX_FILES);
  });

  it.each([null, undefined, 'text', 4, {}, { files: 'no' }])(
    'treats %j as nothing waiting',
    (value) => {
      expect(parseInbox(value)).toEqual(EMPTY_INBOX);
    },
  );

  it('treats an answer without a well formed share token as nothing waiting', () => {
    const files = [{ n: 0, name: 'a.jpg', type: 'image/jpeg', size: 1 }];
    expect(parseInbox({ files })).toEqual(EMPTY_INBOX);
    expect(parseInbox({ files, token: 'not-hex' })).toEqual(EMPTY_INBOX);
  });

  it('builds a same-site file address with the share token, never a data or blob one', () => {
    const url = sharedFileUrl(3, 'a b/c');
    expect(url).toBe('/share-target/file/3?t=a%20b%2Fc');
    expect(url.startsWith('/')).toBe(true);
  });
});
