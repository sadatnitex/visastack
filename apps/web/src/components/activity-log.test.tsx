// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityLog, type ActivityLogEntry } from './activity-log';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const entries: ActivityLogEntry[] = [
  {
    id: '1',
    what: 'Document Viewed',
    who: 'agent@example.test',
    outcome: { label: 'Allowed', tone: 'success' },
    at: hoursAgo(1),
    when: 'Today',
  },
  {
    id: '2',
    what: 'Document Download',
    who: 'System',
    outcome: { label: 'Blocked', tone: 'danger' },
    at: hoursAgo(30),
    when: 'Yesterday',
  },
  {
    id: '3',
    what: 'Grant Created',
    detail: 'Passport',
    who: 'me@example.test',
    at: hoursAgo(24 * 40),
    when: 'Last month',
  },
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<ActivityLog entries={entries} label="Access Log Entries" />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const rows = () =>
  [...host.querySelectorAll('.activity-log-row')].map((row) => row.textContent ?? '');
const select = (name: string) =>
  [...host.querySelectorAll('label')]
    .find((label) => label.textContent?.startsWith(name))
    ?.querySelector('select') as HTMLSelectElement;
const choose = (name: string, value: string) =>
  act(() => {
    const element = select(name);
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
const type = (value: string) =>
  act(() => {
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('the activity log', () => {
  it('keeps every entry in one box the keyboard can scroll, newest first', () => {
    const box = host.querySelector('.activity-log-scroll');
    expect(box?.getAttribute('aria-label')).toBe('Access Log Entries');
    expect(box?.getAttribute('tabindex')).toBe('0');
    expect(rows()).toHaveLength(3);
    expect(host.textContent).toContain('The 3 newest entries, back to Last month.');
  });

  it('finds activities by what happened, who, result, period and words', () => {
    choose('What Happened', 'Document Viewed');
    expect(rows()).toHaveLength(1);
    expect(host.textContent).toContain('Showing 1 of the 3 newest entries, back to Last month.');
    choose('What Happened', '');
    choose('Who', 'System');
    expect(rows()[0]).toContain('Document Download');
    choose('Who', '');
    choose('Result', 'Blocked');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Blocked');
    choose('Result', '');
    choose('When', 'week');
    expect(rows()).toHaveLength(2);
    choose('When', 'any');
    type('passport');
    expect(rows()).toEqual([expect.stringContaining('Grant Created')]);
  });

  it('says when nothing matches and clears every filter at once', () => {
    type('nothing like this');
    expect(host.textContent).toContain('Nothing matches these filters.');
    const clear = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Clear Filters',
    );
    act(() => clear?.click());
    expect(rows()).toHaveLength(3);
    expect((host.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
  });

  it('offers the result filter only when entries carry a result', () => {
    act(() =>
      root.render(
        <ActivityLog entries={entries.map(({ outcome: _outcome, ...e }) => e)} label="Notes" />,
      ),
    );
    expect(select('Result')).toBeUndefined();
  });

  it('stops filtering by a value that has left the list after a refresh', () => {
    choose('Who', 'System');
    expect(rows()).toHaveLength(1);
    act(() =>
      root.render(
        <ActivityLog
          entries={entries.filter((e) => e.who !== 'System')}
          label="Access Log Entries"
        />,
      ),
    );
    expect(rows()).toHaveLength(2);
    expect(select('Who').value).toBe('');
  });
});
