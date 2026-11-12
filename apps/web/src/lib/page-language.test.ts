import { describe, expect, it } from 'vitest';
import { BN_READY_ROUTES, matchesRoute, pageLanguage } from './page-language';

describe('pageLanguage', () => {
  it('is English for an English visitor, even on a ready route', () => {
    expect(pageLanguage('en', '/trust', ['/trust'])).toBe('en');
  });

  it('is English for a Bangla visitor on a route that is not ready', () => {
    expect(pageLanguage('bn', '/status', ['/trust'])).toBe('en');
    expect(pageLanguage('bn', '/status')).toBe('en');
  });

  it('is Bangla for a Bangla visitor on a ready route', () => {
    expect(pageLanguage('bn', '/trust', ['/trust'])).toBe('bn');
    expect(pageLanguage('bn', '/trust/deep/page', ['/trust'])).toBe('bn');
  });

  it('is English when the page address is missing', () => {
    expect(pageLanguage('bn', null, ['/'])).toBe('en');
    expect(pageLanguage('bn', undefined, ['/'])).toBe('en');
    expect(pageLanguage('bn', '', ['/'])).toBe('en');
  });

  it('has no ready route today', () => {
    expect(BN_READY_ROUTES).toEqual([]);
    expect(pageLanguage('bn', '/')).toBe('en');
  });
});

describe('matchesRoute', () => {
  it('matches the exact path and paths below it at a slash boundary', () => {
    expect(matchesRoute('/trust', '/trust')).toBe(true);
    expect(matchesRoute('/trust/x', '/trust')).toBe(true);
    expect(matchesRoute('/trustworthy', '/trust')).toBe(false);
    expect(matchesRoute('/other/trust', '/trust')).toBe(false);
  });

  it('lets "/" match only the home page', () => {
    expect(matchesRoute('/', '/')).toBe(true);
    expect(matchesRoute('/status', '/')).toBe(false);
  });

  it('ignores a trailing slash, a query string and a hash', () => {
    expect(matchesRoute('/trust/', '/trust')).toBe(true);
    expect(matchesRoute('/trust?x=1', '/trust')).toBe(true);
    expect(matchesRoute('/trust#top', '/trust')).toBe(true);
    expect(matchesRoute('/trust', '/trust/')).toBe(true);
  });
});
