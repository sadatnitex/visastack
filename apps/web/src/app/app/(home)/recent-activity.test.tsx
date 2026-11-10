// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RecentActivityEntry } from '../../../lib/recent-activity';
import { RecentActivity } from './recent-activity';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const entry = (id: number, patch: Partial<RecentActivityEntry> = {}): RecentActivityEntry => ({
  id: String(id),
  what: 'File Uploaded',
  at: '2026-11-10T08:00:00.000Z',
  when: '10 Nov 2026, 08:00',
  who: 'You',
  blocked: false,
  ...patch,
});

const href = '/app/applicant/p1/sharing#access-log';
const draw = (entries: RecentActivityEntry[]) =>
  act(() => root.render(<RecentActivity entries={entries} seeAllHref={href} />));

describe('Recent Activity on Home', () => {
  it('is a dated list under a Title Case heading, with See All to the activity page', () => {
    draw([entry(1), entry(2, { what: 'Access Granted', who: 'You' })]);
    expect(container.querySelector('h2')?.textContent).toBe('Recent Activity');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-11-10T08:00:00.000Z',
    );
    const all = container.querySelector('a.home-activity-all') as HTMLAnchorElement;
    expect(all.textContent).toBe('See All');
    expect(all.getAttribute('href')).toBe(href);
  });

  it('shows what it is given and never more than the five Home passes', () => {
    draw(Array.from({ length: 5 }, (_, index) => entry(index)));
    expect(container.querySelectorAll('li')).toHaveLength(5);
  });

  it('marks a blocked attempt with a Blocked chip instead of the name', () => {
    draw([entry(1, { blocked: true, what: 'Document Access' })]);
    expect(container.textContent).toContain('Blocked');
    expect(container.querySelector('.home-activity-who')).toBeNull();
  });

  it('with nothing yet says so in one plain line and offers no See All', () => {
    draw([]);
    expect(container.querySelector('li')).toBeNull();
    expect(container.querySelector('.home-activity-empty')?.textContent).toBe(
      'Nothing yet. Each time your record is opened or changed, it shows here.',
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('is a browse-level block, so the Glance view keeps its word budget', () => {
    draw([entry(1)]);
    expect(container.querySelector('section')?.getAttribute('data-level')).toBe('browse');
  });
});
