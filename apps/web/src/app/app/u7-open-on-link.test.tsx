// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenRowOnLink } from './u7-open-on-link';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  window.location.hash = '';
  document.body.innerHTML = '';
});

async function draw() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <OpenRowOnLink />
        <div id="delete-account">
          <details id="d1">
            <summary>Delete Your Account</summary>
            <div id="inside">Request Account Deletion</div>
          </details>
        </div>
        <details id="d2">
          <summary>Export Your Data</summary>
          <div id="large-export">Large export</div>
        </details>
      </>,
    ),
  );
  return root;
}

describe('OpenRowOnLink (U7)', () => {
  it('opens the fold an address names on arrival, whether the name is on a wrapper or inside the fold', async () => {
    window.location.hash = '#delete-account';
    const root = await draw();
    expect((document.getElementById('d1') as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById('d2') as HTMLDetailsElement).open).toBe(false);
    await act(async () => root.unmount());
    window.location.hash = '#large-export';
    const again = await draw();
    expect((document.getElementById('d2') as HTMLDetailsElement).open).toBe(true);
    await act(async () => again.unmount());
  });

  it('opens a fold when the address changes later, and ignores a name that is not on the page', async () => {
    const root = await draw();
    expect((document.getElementById('d1') as HTMLDetailsElement).open).toBe(false);
    await act(async () => {
      window.location.hash = '#nothing-here';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect((document.getElementById('d1') as HTMLDetailsElement).open).toBe(false);
    await act(async () => {
      window.location.hash = '#inside';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect((document.getElementById('d1') as HTMLDetailsElement).open).toBe(true);
    await act(async () => root.unmount());
  });
});
