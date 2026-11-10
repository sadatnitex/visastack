// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ListWithPane } from './list-with-pane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState({}, '', '/list?item=p1&done=answered');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = () =>
  act(async () =>
    root.render(
      <ListWithPane
        panes={[
          {
            id: 'p1',
            title: 'One',
            content: (
              <div>
                <a href="/list" data-pane-close="true">
                  Back to the List
                </a>
                <a href="/elsewhere">Somewhere Else</a>
              </div>
            ),
          },
        ]}
        initial="p1"
        param="item"
        paneLabel="Details"
        backLabel="Back"
        backHref="/list"
      >
        <p>The list</p>
      </ListWithPane>,
    ),
  );

// jsdom cannot navigate; the click is cancelled after the panel's own handler has run.
const click = (label: string) =>
  act(async () => {
    const stop = (event: Event) => event.preventDefault();
    document.addEventListener('click', stop);
    Array.from(container.querySelectorAll('a'))
      .find((a) => a.textContent === label)
      ?.click();
    document.removeEventListener('click', stop);
  });

describe('a link in the panel that closes it', () => {
  it('shuts the panel the way Back does, so a phone shows the list', async () => {
    await mount();
    expect(container.querySelector('.lp-pane')?.getAttribute('data-sheet')).toBe('open');
    await click('Back to the List');
    expect(container.querySelector('.lp-pane')?.getAttribute('data-sheet')).toBe('closed');
  });

  it('ends a finished-action notice in the address when the panel is closed or another item opens', async () => {
    await mount();
    expect(new URL(window.location.href).searchParams.get('done')).toBe('answered');
    await act(async () => {
      (container.querySelector('.lp-pane-bar a') as HTMLAnchorElement).click();
    });
    expect(new URL(window.location.href).searchParams.get('item')).toBeNull();
    expect(new URL(window.location.href).searchParams.get('done')).toBeNull();
  });

  it('leaves the panel open for an ordinary link', async () => {
    await mount();
    await click('Somewhere Else');
    expect(container.querySelector('.lp-pane')?.getAttribute('data-sheet')).toBe('open');
  });
});
