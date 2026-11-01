// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenGroupOnLink } from './open-group-on-link';

/** WP-SB2: a link to a closed checklist group opens that group, and nothing outside the checklist. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  history.replaceState(null, '', '/app/mission/case-1');
  document.body.innerHTML = `
    <a id="chip" href="#group-check">3 need a check</a>
    <a id="away" href="/elsewhere#group-done">Elsewhere</a>
    <a id="outside-link" href="#outside">Outside</a>
    <div id="readiness">
      <details id="group-you" open><summary>Needs You</summary><p>a</p></details>
      <details id="group-check"><summary>Needs a Check</summary><p id="row-check">b</p></details>
      <details id="group-done"><summary>Done</summary><p>c</p>
        <details id="group-done-rest"><summary>10 More Items</summary><p id="row-deep">d</p></details>
      </details>
    </div>
    <details id="outside"><summary>Other</summary></details>`;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const mount = () => act(() => root.render(<OpenGroupOnLink scopeId="readiness" />));
const isOpen = (id: string) => (document.getElementById(id) as HTMLDetailsElement).open;

describe('OpenGroupOnLink', () => {
  it('opens the group a same-page link points at, and only that one', () => {
    mount();
    (document.getElementById('chip') as HTMLAnchorElement).click();
    expect(isOpen('group-check')).toBe(true);
    expect(isOpen('group-done')).toBe(false);
  });

  it('opens the group around a row the page opened with', () => {
    history.replaceState(null, '', '/app/mission/case-1#row-check');
    mount();
    expect(isOpen('group-check')).toBe(true);
  });

  it('opens the group when the address changes', () => {
    mount();
    act(() => {
      history.replaceState(null, '', '/app/mission/case-1#group-done');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(isOpen('group-done')).toBe(true);
  });

  it('leaves links to other pages and anything outside the checklist alone', () => {
    mount();
    const away = document.getElementById('away') as HTMLAnchorElement;
    away.addEventListener('click', (event) => event.preventDefault());
    away.click();
    (document.getElementById('outside-link') as HTMLAnchorElement).click();
    expect(isOpen('group-done')).toBe(false);
    expect(isOpen('outside')).toBe(false);
  });

  it('ignores an address it cannot read', () => {
    history.replaceState(null, '', '/app/mission/case-1#%E0%A4%A');
    expect(() => mount()).not.toThrow();
  });

  it('opens every closed group around a row folded inside another group', () => {
    history.replaceState(null, '', '/app/mission/case-1#row-deep');
    mount();
    expect(isOpen('group-done-rest')).toBe(true);
    expect(isOpen('group-done')).toBe(true);
  });
});
