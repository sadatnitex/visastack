// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListWithPane } from '../../../../../components/list-pattern';
import { OpenComposerFromHash } from './open-composer-from-hash';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/app/applicant/p/sharing');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

function mount(initial?: string) {
  act(() =>
    root.render(
      <ListWithPane
        panes={[{ id: 'new', title: 'New Sharing Request', content: <p>The form</p> }]}
        initial={initial}
        paneLabel="Sharing Details"
        backLabel="Back to Sharing"
        backHref="/app/applicant/p/sharing"
      >
        <a href="/app/applicant/p/sharing?item=new" data-pane-open="new">
          New Sharing Request
        </a>
        <OpenComposerFromHash />
      </ListWithPane>,
    ),
  );
}
const pane = () => container.querySelector<HTMLElement>('#lp-pane-new');

describe('the old #new-sharing-request address opens the new request panel in place', () => {
  it('opens it without a page load, keeping the rest of the address', () => {
    window.history.replaceState(
      null,
      '',
      '/app/applicant/p/sharing?document=abc#new-sharing-request',
    );
    mount();
    expect(pane()?.hidden).toBe(true);
    act(() => {
      vi.runAllTimers();
    });
    expect(pane()?.hidden).toBe(false);
    // Opened by the list itself, not followed as a link: the chosen document is still in the address.
    expect(window.location.search).toContain('document=abc');
    expect(window.location.search).toContain('item=new');
  });

  it('does nothing for any other address', () => {
    mount();
    act(() => {
      vi.runAllTimers();
    });
    expect(pane()?.hidden).toBe(true);
  });

  it('leaves a panel that the address already opened as it is', () => {
    window.history.replaceState(null, '', '/app/applicant/p/sharing?item=new#new-sharing-request');
    mount('new');
    const before = window.history.length;
    act(() => {
      vi.runAllTimers();
    });
    expect(pane()?.hidden).toBe(false);
    expect(window.history.length).toBe(before);
  });
});
