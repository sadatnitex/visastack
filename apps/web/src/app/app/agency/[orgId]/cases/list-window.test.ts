import { describe, expect, it } from 'vitest';
import { listWindow } from './list-window';

const KEYS = { show: 'show', before: 'before', from: 'from' };
const SIZES = { step: 15, max: 90 };

describe('listWindow (WP-SB5)', () => {
  it('grows from the newest one step at a time, never past the largest step', () => {
    expect(listWindow({}, KEYS, SIZES)).toEqual({ limit: 15, before: undefined, from: undefined });
    expect(listWindow({ show: '30' }, KEYS, SIZES).limit).toBe(30);
    expect(listWindow({ show: '31' }, KEYS, SIZES).limit).toBe(45);
    expect(listWindow({ show: '5000' }, KEYS, SIZES).limit).toBe(90);
    expect(listWindow({ show: '-1' }, KEYS, SIZES).limit).toBe(15);
  });

  it('reads an older page of the largest step from a cursor, with where it starts', () => {
    expect(listWindow({ before: 'abc', from: '91', show: '30' }, KEYS, SIZES)).toEqual({
      limit: 90,
      before: 'abc',
      from: 91,
    });
  });

  it('ignores a malformed cursor or start', () => {
    expect(listWindow({ before: '<x>' }, KEYS, SIZES).before).toBeUndefined();
    expect(listWindow({ before: 'abc', from: '0' }, KEYS, SIZES).from).toBeUndefined();
    expect(listWindow({ before: 'abc', from: '1e3' }, KEYS, SIZES).from).toBeUndefined();
  });
});
