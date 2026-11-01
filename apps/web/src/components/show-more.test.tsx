// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { axeViolations } from '../lib/axe.test-support';
import { ShowMore, showMoreCount } from './show-more';

const cases = { one: 'case', other: 'cases' };

function render(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

describe('showMoreCount', () => {
  it('words the count for known and unknown totals', () => {
    expect(showMoreCount({ shown: 10, total: 42, noun: cases, more: true })).toBe(
      'Showing 10 of 42 cases.',
    );
    expect(showMoreCount({ shown: 10, total: 7, noun: cases, more: false })).toBe(
      'Showing all 7 cases.',
    );
    expect(showMoreCount({ shown: 10, total: 1, noun: cases, more: false })).toBe(
      'Showing the only case.',
    );
    expect(showMoreCount({ shown: 10, noun: cases, more: true })).toBe(
      'Showing the first 10 cases.',
    );
    expect(showMoreCount({ shown: 1, noun: cases, more: false })).toBe('Showing all 1 case.');
  });
});

describe('ShowMore', () => {
  it('is a real link to the next step that keeps filters and lands on the first new row', () => {
    const host = render(
      <ShowMore
        id="cases-more"
        landOn="case-row-10"
        pathname="/app/agency/org-1/cases"
        searchParams={{ status: 'open', show: '10' }}
        next={{ show: 20 }}
        shown={10}
        total={42}
        noun={cases}
      />,
    );
    const link = host.querySelector('a');
    expect(link?.getAttribute('href')).toBe(
      '/app/agency/org-1/cases?status=open&show=20#case-row-10',
    );
    expect(link?.textContent).toBe('Show More cases');
    expect(host.querySelector('output')?.textContent).toBe('Showing 10 of 42 cases.');
    expect(host.querySelector('.show-more')?.id).toBe('cases-more');
  });

  it('lands on itself when no row id is given, and words the older-entries form', () => {
    const host = render(
      <ShowMore
        id="history-more"
        pathname="/app/applicant/a-1/history"
        next={{ before: 'eyJ2IjoxfQ' }}
        shown={50}
        noun={{ one: 'entry', other: 'entries' }}
        label="Show Older Entries"
      />,
    );
    const link = host.querySelector('a');
    expect(link?.getAttribute('href')).toBe(
      '/app/applicant/a-1/history?before=eyJ2IjoxfQ#history-more',
    );
    expect(link?.textContent).toBe('Show Older Entries');
  });

  it('shows only the count when nothing more exists', () => {
    const host = render(
      <ShowMore id="x" pathname="/app/x" next={null} shown={7} total={7} noun={cases} />,
    );
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toBe('Showing all 7 cases.');
  });

  it('passes the automated accessibility rules', async () => {
    const html = renderToStaticMarkup(
      <ShowMore id="x" pathname="/app/x" next={{ show: 20 }} shown={10} total={30} noun={cases} />,
    );
    expect(await axeViolations(html)).toEqual([]);
  });

  it('moves keyboard focus to the first new row once the larger list arrives', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const page = (shown: number) => (
      <>
        <ol>
          {Array.from({ length: shown }, (_, n) => `row-${n}`).map((rowId) => (
            <li id={rowId} key={rowId}>
              {rowId}
            </li>
          ))}
        </ol>
        <ShowMore
          id="more"
          landOn={`row-${shown}`}
          pathname="/app/x"
          next={{ show: shown + 10 }}
          shown={shown}
          total={40}
          noun={cases}
        />
      </>
    );
    act(() => root.render(page(10)));
    expect(document.activeElement).toBe(document.body);
    host.querySelector('a')?.focus();
    window.history.replaceState(null, '', '#row-10');
    act(() => root.render(page(20)));
    const landed = document.getElementById('row-10');
    expect(document.activeElement).toBe(landed);
    expect(landed?.getAttribute('tabindex')).toBe('-1');
    window.history.replaceState(null, '', '#');
    act(() => root.unmount());
    host.remove();
  });
});
