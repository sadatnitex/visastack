import { describe, expect, it } from 'vitest';
import type { NavLink } from './navigation';
import { tabBadges } from './tab-badges';
import { travellerEntryPoints } from './workspace-navigation';

const LINKS: readonly NavLink[] = travellerEntryPoints('p1');
const HOME = '/app/applicant/p1';
const SHARING = '/app/applicant/p1/sharing';

describe('the counts on the phone bar', () => {
  it('shows nothing without the toolbar state, or with nothing unread', () => {
    expect(tabBadges(LINKS, undefined)).toEqual({});
    expect(tabBadges(LINKS, { unread: 0 })).toEqual({});
  });

  it('puts notices about requests on Sharing & Requests and every other notice on Home', () => {
    expect(tabBadges(LINKS, { unread: 5, unreadRequests: 2 })).toEqual({ [SHARING]: 2, [HOME]: 3 });
  });

  it('counts a notice once: the two tabs add up to the bell', () => {
    const counts = tabBadges(LINKS, { unread: 7, unreadRequests: 4 });
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(7);
  });

  it('leaves a tab out when its part is zero', () => {
    expect(tabBadges(LINKS, { unread: 4, unreadRequests: 4 })).toEqual({ [SHARING]: 4 });
    expect(tabBadges(LINKS, { unread: 4 })).toEqual({ [HOME]: 4 });
  });

  it('never lets a request count above the bell', () => {
    expect(tabBadges(LINKS, { unread: 2, unreadRequests: 9 })).toEqual({ [SHARING]: 2 });
  });

  it('ignores destinations that are not Home or Sharing & Requests', () => {
    const other: readonly NavLink[] = [{ href: '/app/agency/o1', label: 'Overview', exact: true }];
    expect(tabBadges(other, { unread: 3, unreadRequests: 1 })).toEqual({});
  });
});
