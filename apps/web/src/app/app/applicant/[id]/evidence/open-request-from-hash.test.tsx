// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRequestFromHash } from './open-request-from-hash';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const clicked = vi.fn();
beforeEach(() => {
  host = document.createElement('div');
  host.innerHTML = `
    <details id="folder"><summary>Finished</summary>
      <a href="?item=r1" data-pane-open="r1">One</a>
      <a href="?item=r2" data-pane-open="r2" aria-current="true">Two</a>
    </details>`;
  document.body.append(host);
  for (const link of host.querySelectorAll('a')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      clicked(link.getAttribute('data-pane-open'));
    });
  }
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clicked.mockReset();
  window.location.hash = '';
});

const mount = () => act(() => root.render(<OpenRequestFromHash />));

describe('opening a request from an email link', () => {
  it('opens the folder and the panel of the request the address names', () => {
    window.location.hash = '#request-r1';
    mount();
    expect(clicked).toHaveBeenCalledWith('r1');
    expect((host.querySelector('#folder') as HTMLDetailsElement).open).toBe(true);
  });

  it('does nothing for a request that is not on the page, or an address with no request', () => {
    window.location.hash = '#request-gone';
    mount();
    window.location.hash = '#evidence';
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(clicked).not.toHaveBeenCalled();
  });

  it('leaves a panel that is already open alone', () => {
    window.location.hash = '#request-r2';
    mount();
    expect(clicked).not.toHaveBeenCalled();
  });

  it('follows the address when it changes', () => {
    mount();
    expect(clicked).not.toHaveBeenCalled();
    window.location.hash = '#request-r1';
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(clicked).toHaveBeenCalledWith('r1');
  });
});
