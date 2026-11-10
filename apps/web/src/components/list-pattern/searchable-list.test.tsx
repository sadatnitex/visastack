// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type SearchableItem, SearchableList, matchesSearch } from './searchable-list';

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

const NAMES = [
  'Tourist visa for Japan',
  'Student visa for Canada',
  'Work permit for Germany',
  'Tourist visa for Singapore',
  'Family visit for the UK',
  'Business visa for Malaysia',
];

const items: SearchableItem[] = NAMES.map((name, index) => ({
  id: `c${index}`,
  text: name,
  node: (
    <a data-testid="hit" href={`/app/mission/c${index}`}>
      {name}
    </a>
  ),
}));

function draw(rows: readonly SearchableItem[] = items, minRows?: number) {
  act(() =>
    root.render(
      <SearchableList
        items={rows}
        noun={{ one: 'case', other: 'cases' }}
        searchLabel="Search Cases"
        {...(minRows !== undefined ? { minRows } : {})}
        resultsClassName="rows"
      >
        <div data-testid="layout">
          {rows.map((row) => (
            <span key={row.id}>{row.text}</span>
          ))}
        </div>
      </SearchableList>,
    ),
  );
}

function type(value: string) {
  const input = container.querySelector('input[type="search"]') as HTMLInputElement;
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const hits = () =>
  [...container.querySelectorAll('[data-testid="hit"]')].map((el) => el.textContent);
const announced = () => container.querySelector('output')?.textContent ?? '';

describe('matchesSearch', () => {
  it('needs every typed word, in any order, ignoring capitals', () => {
    expect(matchesSearch('Tourist visa for Japan', 'japan TOURIST')).toBe(true);
    expect(matchesSearch('Tourist visa for Japan', 'japan student')).toBe(false);
    expect(matchesSearch('Tourist visa for Japan', '   ')).toBe(true);
  });
});

describe('SearchableList', () => {
  it('draws no search for a short list, and the page layout untouched', () => {
    draw(items.slice(0, 3));
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.querySelector('[data-testid="layout"]')).not.toBeNull();
  });

  it('shows the page layout while nothing is typed, with a named search box', () => {
    draw();
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(container.querySelector('.sr-only')?.textContent).toBe('Search Cases');
    expect(container.querySelector('[data-testid="layout"]')).not.toBeNull();
    expect(hits()).toEqual([]);
  });

  it('filters the rows as you type and announces how many match', () => {
    draw();
    type('tourist');
    expect(hits()).toEqual(['Tourist visa for Japan', 'Tourist visa for Singapore']);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
    expect(announced()).toBe('2 cases match.');
    type('canada');
    expect(hits()).toEqual(['Student visa for Canada']);
    expect(announced()).toBe('1 case matches.');
  });

  it('says what to do when nothing matches, and Clear Search brings every row back', () => {
    draw();
    type('zzz');
    expect(hits()).toEqual([]);
    const line = container.querySelector('.lp-filter-none') as HTMLElement;
    expect(line.textContent).toContain('No cases match. Clear the search to see more.');
    expect(announced()).toBe('0 cases match.');
    const clear = line.querySelector('button') as HTMLButtonElement;
    expect(clear.textContent).toBe('Clear Search');
    act(() => clear.click());
    expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
    expect(container.querySelector('[data-testid="layout"]')).not.toBeNull();
    expect(container.querySelector('.lp-filter-none')).toBeNull();
  });

  it('clearing the box by hand shows the page layout again', () => {
    draw();
    type('japan');
    expect(hits()).toHaveLength(1);
    type('');
    expect(container.querySelector('[data-testid="layout"]')).not.toBeNull();
    expect(announced()).toBe('');
  });
});
