// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_DATA_ATTRIBUTE, SaveDataFlag, applySaveData } from './save-data-flag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  document.documentElement.removeAttribute(SAVE_DATA_ATTRIBUTE);
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(SAVE_DATA_ATTRIBUTE);
});

/** A stand-in for navigator.connection that can report a change. */
function fakeConnection(saveData: boolean) {
  const listeners = new Set<() => void>();
  return {
    saveData,
    addEventListener: (_type: 'change', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'change', listener: () => void) => listeners.delete(listener),
    change(next: boolean) {
      this.saveData = next;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

function mount() {
  act(() => {
    root = createRoot(container);
    root.render(<SaveDataFlag />);
  });
}

describe('SaveDataFlag', () => {
  it('marks the page when the browser reports data saver', () => {
    vi.stubGlobal('navigator', { connection: fakeConnection(true) });
    mount();
    expect(document.documentElement.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(true);
  });

  it('leaves the page alone when data saver is off', () => {
    vi.stubGlobal('navigator', { connection: fakeConnection(false) });
    mount();
    expect(document.documentElement.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(false);
  });

  it('does nothing, and does not fail, when the browser has no connection information', () => {
    vi.stubGlobal('navigator', {});
    expect(() => mount()).not.toThrow();
    expect(document.documentElement.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(false);
    vi.stubGlobal('navigator', { connection: null });
    act(() => root?.unmount());
    root = undefined;
    expect(() => mount()).not.toThrow();
    expect(document.documentElement.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(false);
  });

  it('follows a change while the page is open, and lets go when it unmounts', () => {
    const connection = fakeConnection(false);
    vi.stubGlobal('navigator', { connection });
    mount();
    expect(connection.listeners.size).toBe(1);
    act(() => connection.change(true));
    expect(document.documentElement.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(true);
    act(() => connection.change(false));
    expect(document.documentElement.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(false);
    act(() => root?.unmount());
    root = undefined;
    expect(connection.listeners.size).toBe(0);
  });

  it('keeps the mark the server set from the request header when the browser says nothing new', () => {
    document.documentElement.setAttribute(SAVE_DATA_ATTRIBUTE, '');
    vi.stubGlobal('navigator', { connection: fakeConnection(false) });
    mount();
    expect(document.documentElement.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(true);
    vi.stubGlobal('navigator', {});
    act(() => root?.unmount());
    root = undefined;
    mount();
    expect(document.documentElement.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(true);
  });

  it('renders nothing', () => {
    vi.stubGlobal('navigator', {});
    mount();
    expect(container.innerHTML).toBe('');
  });

  it('applySaveData sets and clears only its own attribute', () => {
    const element = document.createElement('html');
    element.setAttribute('lang', 'en');
    applySaveData(element, { saveData: true });
    expect(element.getAttribute(SAVE_DATA_ATTRIBUTE)).toBe('');
    applySaveData(element, { saveData: false });
    expect(element.hasAttribute(SAVE_DATA_ATTRIBUTE)).toBe(false);
    applySaveData(element, undefined);
    expect(element.getAttribute('lang')).toBe('en');
  });
});
