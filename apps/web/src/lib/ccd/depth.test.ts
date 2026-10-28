import { describe, expect, it } from 'vitest';
import {
  DEPTH_FAMILIES,
  choiceFor,
  depthRank,
  parseDepthCookie,
  resolveAuto,
  serializeDepthCookie,
} from './depth';

describe('the depth cookie', () => {
  it('round-trips a level per screen family', () => {
    const value = serializeDepthCookie({ account: 'everything', home: 'glance' });
    expect(parseDepthCookie(value)).toEqual({ account: 'everything', home: 'glance' });
  });

  it('holds level words only, nothing about the person', () => {
    const value = decodeURIComponent(serializeDepthCookie({ case: 'browse' }));
    expect(value).toBe('{"case":"browse"}');
  });

  it('drops unknown families, unknown levels and anything that is not a plain map', () => {
    expect(
      parseDepthCookie(
        encodeURIComponent(
          JSON.stringify({ account: 'everything', secret: 'glance', home: 'all' }),
        ),
      ),
    ).toEqual({ account: 'everything' });
    expect(parseDepthCookie(encodeURIComponent('["account"]'))).toEqual({});
    expect(parseDepthCookie('%7Bnot json')).toEqual({});
    expect(parseDepthCookie(undefined)).toEqual({});
  });

  it('starts every screen on auto until a level is chosen', () => {
    for (const family of DEPTH_FAMILIES) expect(choiceFor({}, family)).toBe('auto');
    expect(choiceFor({ sharing: 'browse' }, 'sharing')).toBe('browse');
  });

  it('means Glance on a phone and Browse on a wider screen', () => {
    expect(resolveAuto(true)).toBe('glance');
    expect(resolveAuto(false)).toBe('browse');
    expect(depthRank('glance')).toBeLessThan(depthRank('browse'));
    expect(depthRank('browse')).toBeLessThan(depthRank('everything'));
  });
});
