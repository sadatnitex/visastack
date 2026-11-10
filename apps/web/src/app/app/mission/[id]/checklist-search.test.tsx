// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChecklistSearch } from './checklist-search';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const NAMES = [
  'Passport',
  'Bank statement',
  'Hotel booking',
  'Flight booking',
  'Salary slip',
  'Tax return',
  'Photograph',
  'Insurance',
  'Employment letter',
];

function list(count: number) {
  const scope = document.createElement('div');
  scope.id = 'readiness';
  scope.innerHTML = `
    <details class="collapsible-group" id="g1"><summary>One</summary>
      <div>${NAMES.slice(0, count - 3)
        .map(
          (n) =>
            `<div data-pattern="list-row"><a data-pane-open="${n}" aria-label="${n}">${n}</a></div>`,
        )
        .join('')}</div></details>
    <details class="collapsible-group" id="g2"><summary>Two</summary>
      <div>${NAMES.slice(count - 3, count)
        .map(
          (n) =>
            `<div data-pattern="list-row"><a data-pane-open="${n}" aria-label="${n}">${n}</a></div>`,
        )
        .join('')}</div></details>`;
  document.body.append(scope);
  return scope;
}

const type = (value: string) => {
  const input = host.querySelector('input[type="search"]') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('ChecklistSearch', () => {
  it('is not drawn for a short checklist', () => {
    const scope = list(6);
    act(() => root.render(<ChecklistSearch scopeId="readiness" rows={6} />));
    expect(host.querySelector('input')).toBeNull();
    scope.remove();
  });

  it('is drawn for a long one, hides the rows that do not match and opens the folder that holds a match', () => {
    const scope = list(9);
    act(() => root.render(<ChecklistSearch scopeId="readiness" rows={9} />));
    expect(host.querySelector('.lp-sticky-filter')).not.toBeNull();
    type('booking');
    const shown = [...scope.querySelectorAll<HTMLElement>('[data-pattern="list-row"]')].filter(
      (row) => !row.hidden,
    );
    expect(shown.map((row) => row.textContent)).toEqual(['Hotel booking', 'Flight booking']);
    expect((scope.querySelector('#g1') as HTMLDetailsElement).open).toBe(true);
    expect((scope.querySelector('#g2') as HTMLElement).hidden).toBe(true);
    expect(host.querySelector('output')?.textContent).toContain('2 of 9 items match');
    scope.remove();
  });

  it('shows every row again when the search is cleared, and says when nothing matches', () => {
    const scope = list(9);
    act(() => root.render(<ChecklistSearch scopeId="readiness" rows={9} />));
    type('zzz');
    expect(host.textContent).toContain('No Items Match');
    type('');
    const hidden = scope.querySelectorAll('[data-pattern="list-row"][hidden], details[hidden]');
    expect(hidden).toHaveLength(0);
    scope.remove();
  });
});
