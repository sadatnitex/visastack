// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenFoldOnLink } from './open-fold-on-link';

/**
 * WP-LIFT-B: on a phone each rail card is one closed row, so a link to something inside it (the
 * date checks chip, Snapshots, Pick a Checklist) must open that row, in every browser.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  history.replaceState(null, '', '/app/mission/case-1');
  document.body.innerHTML = `
    <a id="to-trip" href="#trip-checks">1 date to check</a>
    <a id="to-pack" href="/app/mission/case-1#pack">Pick a Checklist</a>
    <a id="away" href="/elsewhere#snapshots">Elsewhere</a>
    <a id="to-plain" href="#plain">Plain</a>
    <aside class="split-rail">
      <details class="lift-fold" id="fold-trip"><summary>Trip Date Checks</summary><div id="trip-checks"><p id="inner">x</p></div></details>
      <details class="lift-fold" id="fold-pack"><summary>Requirement Pack</summary><div id="pack">y</div></details>
      <details class="lift-fold" id="fold-snap"><summary>Snapshots</summary><div id="snapshots">z</div></details>
    </aside>
    <details id="plain-details"><summary>Other</summary><div id="plain">w</div></details>`;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const mount = () => act(() => root.render(<OpenFoldOnLink />));
const isOpen = (id: string) => (document.getElementById(id) as HTMLDetailsElement).open;

describe('OpenFoldOnLink', () => {
  it('opens the row a same-page link points into, and only that row', () => {
    mount();
    (document.getElementById('to-trip') as HTMLAnchorElement).click();
    expect(isOpen('fold-trip')).toBe(true);
    expect(isOpen('fold-pack')).toBe(false);
    expect(isOpen('fold-snap')).toBe(false);
  });

  it('opens the row for a link written with this page address in front of the anchor', () => {
    mount();
    (document.getElementById('to-pack') as HTMLAnchorElement).click();
    expect(isOpen('fold-pack')).toBe(true);
  });

  it('opens the row around an element the page opened with, even deep inside it', () => {
    history.replaceState(null, '', '/app/mission/case-1#inner');
    mount();
    expect(isOpen('fold-trip')).toBe(true);
  });

  it('opens the row when the address changes', () => {
    mount();
    act(() => {
      history.replaceState(null, '', '/app/mission/case-1#snapshots');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(isOpen('fold-snap')).toBe(true);
  });

  it('leaves links to other pages, unknown anchors and anything that is not a rail row alone', () => {
    mount();
    const away = document.getElementById('away') as HTMLAnchorElement;
    away.addEventListener('click', (event) => event.preventDefault());
    away.click();
    (document.getElementById('to-plain') as HTMLAnchorElement).click();
    expect(isOpen('fold-snap')).toBe(false);
    expect(isOpen('plain-details')).toBe(false);
    history.replaceState(null, '', '/app/mission/case-1#nothing-here');
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(document.querySelectorAll('details[open]')).toHaveLength(0);
  });

  it('stops listening when it is removed', () => {
    mount();
    act(() => root.render(null));
    (document.getElementById('to-trip') as HTMLAnchorElement).click();
    expect(isOpen('fold-trip')).toBe(false);
  });
});
