// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManageMenu } from './manage-menu';
import {
  MANAGE_ACTIONS,
  type ManageActionEntry,
  type ManageActionProps,
  registeredActions,
} from './registry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Panel({ documentName, onClose }: ManageActionProps) {
  return (
    <div>
      <p>Archive {documentName}?</p>
      <button type="button" onClick={onClose}>
        Close Panel
      </button>
    </div>
  );
}

const registry: Record<string, ManageActionEntry> = {
  ARCHIVE: { label: 'Archive', Component: Panel },
  REPLACE: { label: 'Replace With a Newer Document', Component: Panel },
  RESTORE: { label: 'Restore', Component: Panel },
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const key = (target: Element, name: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
const items = () => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];

describe('the action registry', () => {
  it('ships empty: no lane has registered an action yet', () => {
    expect(Object.keys(MANAGE_ACTIONS)).toEqual([]);
  });
  it('keeps only registered actions, in the given order', () => {
    expect(
      registeredActions(['ARCHIVE', 'DELETE_DUPLICATE', 'REPLACE'], registry).map((i) => i.action),
    ).toEqual(['ARCHIVE', 'REPLACE']);
  });
});

describe('ManageMenu', () => {
  it('renders nothing when no allowed action is registered', () => {
    act(() =>
      root.render(
        <ManageMenu
          applicantId="a1"
          documentId="d1"
          documentName="Passport"
          actions={['ARCHIVE', 'REPLACE']}
        />,
      ),
    );
    expect(container.innerHTML).toBe('');
  });

  it('is a menu button that the keyboard can open, move through and close, returning focus', () => {
    act(() =>
      root.render(
        <ManageMenu
          applicantId="a1"
          documentId="d1"
          documentName="Passport"
          actions={['ARCHIVE', 'REPLACE']}
          registry={registry}
        />,
      ),
    );
    const button = trigger();
    if (!button) throw new Error('no menu button');
    expect(button.textContent).toBe('Manage');
    expect(button.getAttribute('aria-label')).toBe('Manage Passport');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.focus();
    key(button, 'ArrowDown');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="menu"]')?.id).toBe(button.getAttribute('aria-controls'));
    expect(items().map((item) => item.textContent)).toEqual([
      'Archive',
      'Replace With a Newer Document',
    ]);
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as Element, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1] as Element, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as Element, 'End');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1] as Element, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as Element, 'Escape');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    key(button, 'ArrowUp');
    expect(document.activeElement).toBe(items()[1]);
  });

  it('opens the chosen action and puts focus back on the button when it closes', () => {
    act(() =>
      root.render(
        <ManageMenu
          applicantId="a1"
          documentId="d1"
          documentName="Passport"
          actions={['ARCHIVE']}
          registry={registry}
        />,
      ),
    );
    act(() => trigger()?.click());
    act(() => items()[0]?.click());
    expect(container.textContent).toContain('Archive Passport?');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    // The keyboard carries on inside the chosen action, never from the top of the page.
    expect(document.activeElement).toBe(container.querySelector('.lc-manage-panel'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Archive');
    const close = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close Panel',
    );
    act(() => close?.click());
    expect(container.textContent).not.toContain('Archive Passport?');
    expect(document.activeElement).toBe(trigger());
  });

  it('opens a deep-linked action only when the rule allows it', () => {
    act(() =>
      root.render(
        <ManageMenu
          applicantId="a1"
          documentId="d1"
          documentName="Passport"
          actions={['ARCHIVE']}
          initialAction="ARCHIVE"
          registry={registry}
        />,
      ),
    );
    expect(container.textContent).toContain('Archive Passport?');
    act(() =>
      root.render(
        <ManageMenu
          key="other"
          applicantId="a1"
          documentId="d2"
          documentName="Visa"
          actions={['ARCHIVE']}
          initialAction="RESTORE"
          registry={registry}
        />,
      ),
    );
    expect(container.textContent).not.toContain('Visa?');
  });
});
