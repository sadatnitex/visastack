import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHOW_MAX,
  TEAM_LIST_STEP,
  TRAVELLER_LIST_STEP,
  firstParam,
  nextShow,
  pagingHref,
  parseCursor,
  parseShow,
} from './paging';

describe('firstParam', () => {
  it('keeps the first of repeated parameters', () => {
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam('a')).toBe('a');
    expect(firstParam(['b', 'c'])).toBe('b');
    expect(firstParam([])).toBeUndefined();
  });
});

describe('parseShow', () => {
  const step = TRAVELLER_LIST_STEP;
  it('gives one step for missing or malformed values', () => {
    for (const raw of [undefined, '', 'ten', '-10', '1e3', '10.5', ' 20', '9999999', '0x20']) {
      expect(parseShow(raw, { step })).toBe(step);
    }
  });
  it('rounds up to whole steps and stops at the ceiling', () => {
    expect(parseShow('1', { step })).toBe(10);
    expect(parseShow('11', { step })).toBe(20);
    expect(parseShow('30', { step })).toBe(30);
    expect(parseShow(['40', '90'], { step })).toBe(40);
    expect(parseShow('999999', { step })).toBe(SHOW_MAX);
    // Show More never grows past the largest page the services return.
    const services = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'packages', 'services', 'src', 'paging.ts'),
      'utf8',
    );
    expect(services).toContain(`export const PAGE_LIMIT_MAX = ${SHOW_MAX};`);
    expect(parseShow('999', { step: TEAM_LIST_STEP, max: 100 })).toBe(100);
    expect(parseShow('999', { step: 30, max: 100 })).toBe(90);
  });
});

describe('nextShow', () => {
  it('adds one step until the ceiling, then says there is no more', () => {
    expect(nextShow(10, { step: 10 })).toBe(20);
    expect(nextShow(90, { step: 10 })).toBe(100);
    expect(nextShow(100, { step: 10 })).toBeNull();
    expect(nextShow(75, { step: 25, max: 100 })).toBe(100);
    expect(nextShow(100, { step: 25, max: 100 })).toBeNull();
  });
});

describe('parseCursor', () => {
  it('passes cursor-shaped values and drops everything else', () => {
    expect(parseCursor('eyJ2IjoxfQ')).toBe('eyJ2IjoxfQ');
    expect(parseCursor(['abc_-1', 'zzz'])).toBe('abc_-1');
    for (const raw of [undefined, '', 'a b', 'a/b', 'a+b=', '<x>', 'x'.repeat(513)]) {
      expect(parseCursor(raw)).toBeUndefined();
    }
  });
});

describe('pagingHref', () => {
  it('keeps other parameters, replaces the changed ones and removes cleared ones', () => {
    expect(
      pagingHref(
        '/app/admin/audit',
        { type: 'login', show: '20', before: 'old' },
        {
          show: 30,
          before: null,
        },
      ),
    ).toBe('/app/admin/audit?type=login&show=30');
  });
  it('keeps repeated parameters and adds the landing anchor', () => {
    expect(
      pagingHref('/app/x', new URLSearchParams('tag=a&tag=b'), { before: 'abc' }, 'older-entries'),
    ).toBe('/app/x?tag=a&tag=b&before=abc#older-entries');
    expect(pagingHref('/app/x', { tag: ['a', 'b'], skip: undefined }, {})).toBe(
      '/app/x?tag=a&tag=b',
    );
  });
  it('encodes values so an address cannot be broken out of', () => {
    expect(pagingHref('/app/x', { q: 'a&b=c #d' }, {}, 'list one')).toBe(
      '/app/x?q=a%26b%3Dc+%23d#list%20one',
    );
  });
  it('never builds a link to another site', () => {
    expect(() => pagingHref('https://example.com/x', undefined, {})).toThrow();
    expect(() => pagingHref('//example.com/x', undefined, {})).toThrow();
    expect(() => pagingHref('/\\example.com/x', undefined, {})).toThrow();
    expect(() => pagingHref('/\t/example.com/x', undefined, {})).toThrow();
    expect(() => pagingHref('/\n/example.com/x', undefined, {})).toThrow();
    expect(() => pagingHref('/app/x y', undefined, {})).toThrow();
    expect(() => pagingHref('x', undefined, {})).toThrow();
  });
});
