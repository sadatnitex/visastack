// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNDO_WINDOW_MS, UndoStatus } from './undo-status';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const undoButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Undo');

describe('UndoStatus', () => {
  it('is a polite status with Undo for ten seconds, and keeps focus on the page when Undo goes', () => {
    act(() => root.render(<UndoStatus message="Moved to Archived." onUndo={() => undefined} />));
    const status = container.querySelector('output');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('Moved to Archived.');
    undoButton()?.focus();
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1));
    expect(undoButton()).toBeDefined();
    act(() => vi.advanceTimersByTime(1));
    expect(undoButton()).toBeUndefined();
    expect(document.activeElement).toBe(status);
  });

  it('undoes once and says so', async () => {
    const onUndo = vi.fn(async () => undefined);
    act(() => root.render(<UndoStatus message="Moved to Archived." onUndo={onUndo} />));
    await act(async () => undoButton()?.click());
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(container.querySelector('output')?.textContent).toBe('Undone.');
    expect(undoButton()).toBeUndefined();
    expect(document.activeElement).toBe(container.querySelector('output'));
  });
});
