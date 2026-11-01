// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LandingStoryHelper } from './landing-story';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

function page() {
  document.body.innerHTML = `
    <nav><a id="menu" href="/#how-it-works">How It Works</a><a id="away" href="/status#how-it-works">Away</a></nav>
    <div class="c1-bento" tabindex="0"></div>
    <details id="problem"><summary>Problem</summary><p>Body</p></details>
    <details id="how-it-works"><summary>How</summary><p>Steps</p></details>
    <details id="other"><summary>Other</summary></details>`;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
}
const mount = () =>
  act(() =>
    root.render(
      <LandingStoryHelper groupIds={['problem', 'how-it-works']} rowSelector=".c1-bento" />,
    ),
  );
const isOpen = (id: string) => (document.getElementById(id) as HTMLDetailsElement).open;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
  window.history.replaceState(null, '', '/');
  page();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the landing story helper (WP-SB8)', () => {
  it('opens the group named in the address when the page loads', () => {
    window.history.replaceState(null, '', '/#how-it-works');
    mount();
    expect(isOpen('how-it-works')).toBe(true);
    expect(isOpen('problem')).toBe(false);
  });

  it('opens a group when a link on this page points at it, before the page scrolls there', () => {
    mount();
    act(() => document.getElementById('menu')?.click());
    expect(isOpen('how-it-works')).toBe(true);
  });

  it('ignores links to other pages and ids that are not story groups', () => {
    mount();
    act(() => document.getElementById('away')?.click());
    expect(isOpen('how-it-works')).toBe(false);
    window.history.replaceState(null, '', '/#other');
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(isOpen('other')).toBe(false);
    window.history.replaceState(null, '', '/#%E0%A4%A');
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(isOpen('problem')).toBe(false);
  });

  it('opens a group on a hash change', () => {
    mount();
    window.history.replaceState(null, '', '/#problem');
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(isOpen('problem')).toBe(true);
  });

  it('drops the keyboard stop on the card row when the row does not scroll sideways', () => {
    mount();
    expect(document.querySelector('.c1-bento')?.hasAttribute('tabindex')).toBe(false);
  });
});
