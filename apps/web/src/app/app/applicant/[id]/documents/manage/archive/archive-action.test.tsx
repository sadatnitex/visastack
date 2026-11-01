// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const archiveDocumentAction = vi.fn();
const restoreDocumentAction = vi.fn();
vi.mock('./actions', () => ({ archiveDocumentAction, restoreDocumentAction }));
const { ArchiveAction, RestoreAction } = await import('./archive-action');
const { UNDO_WINDOW_MS } = await import('../../../../../../../components/lifecycle/undo-status');
const { MANAGE_ACTIONS } = await import('../registry');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  onClose.mockReset();
  archiveDocumentAction.mockReset();
  restoreDocumentAction.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const props = { applicantId: 'a1', documentId: 'd1', documentName: 'Bank Statement', onClose };
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const buttonNamed = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name);

describe('LC-A1 Archive and Restore actions', () => {
  it('are registered under the A1 anchor with their vocabulary labels', () => {
    expect(MANAGE_ACTIONS.ARCHIVE?.label).toBe('Archive');
    expect(MANAGE_ACTIONS.ARCHIVE?.Component).toBe(ArchiveAction);
    expect(MANAGE_ACTIONS.RESTORE?.label).toBe('Restore');
    expect(MANAGE_ACTIONS.RESTORE?.Component).toBe(RestoreAction);
  });

  it('archives at once, exactly once, then offers Undo and refreshes the list only after it', async () => {
    archiveDocumentAction.mockResolvedValue({ ok: true, changed: true });
    act(() =>
      root.render(
        <StrictMode>
          <ArchiveAction {...props} />
        </StrictMode>,
      ),
    );
    expect(container.querySelector('output')?.textContent).toBe('Moving to Archived.');
    await flush();
    expect(archiveDocumentAction).toHaveBeenCalledTimes(1);
    expect(archiveDocumentAction).toHaveBeenCalledWith('a1', 'd1');
    expect(container.textContent).toContain(
      'Bank Statement moved to Archived. Cases that chose it still use it.',
    );
    expect(buttonNamed('Undo')).toBeDefined();
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(restoreDocumentAction).not.toHaveBeenCalled();
  });

  it('Undo restores the document and refreshes at once', async () => {
    archiveDocumentAction.mockResolvedValue({ ok: true, changed: true });
    restoreDocumentAction.mockResolvedValue({ ok: true, changed: true });
    act(() => root.render(<ArchiveAction {...props} />));
    await flush();
    act(() => buttonNamed('Undo')?.click());
    await flush();
    expect(restoreDocumentAction).toHaveBeenCalledWith('a1', 'd1');
    expect(container.textContent).toContain('Undone. It is back in your current documents.');
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a failed Undo says so, keeps Undo, and refreshes only after a new ten seconds', async () => {
    archiveDocumentAction.mockResolvedValue({ ok: true, changed: true });
    restoreDocumentAction.mockResolvedValue({ ok: false, message: 'nope' });
    act(() => root.render(<ArchiveAction {...props} />));
    await flush();
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1000));
    act(() => buttonNamed('Undo')?.click());
    await flush();
    expect(container.textContent).toContain('That could not be undone. Try again.');
    expect(buttonNamed('Undo')).toBeDefined();
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a refused archive explains, moves focus to the reason and offers Try Again and Close', async () => {
    archiveDocumentAction.mockResolvedValueOnce({
      ok: false,
      message: 'This document is not available to archive or restore right now.',
    });
    act(() => root.render(<ArchiveAction {...props} />));
    await flush();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(
      'This document is not available to archive or restore right now.',
    );
    expect(document.activeElement).toBe(alert);
    expect(buttonNamed('Undo')).toBeUndefined();
    archiveDocumentAction.mockResolvedValueOnce({ ok: true, changed: true });
    act(() => buttonNamed('Try Again')?.click());
    await flush();
    expect(archiveDocumentAction).toHaveBeenCalledTimes(2);
    expect(buttonNamed('Undo')).toBeDefined();
  });

  it('a dropped connection reads as a failed try, and Close closes', async () => {
    archiveDocumentAction.mockRejectedValue(new Error('network'));
    act(() => root.render(<ArchiveAction {...props} />));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'That did not go through. Check your connection and try again.',
    );
    act(() => buttonNamed('Close')?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('Restore runs at once and Undo archives it again', async () => {
    restoreDocumentAction.mockResolvedValue({ ok: true, changed: true });
    archiveDocumentAction.mockResolvedValue({ ok: true, changed: true });
    act(() => root.render(<RestoreAction {...props} />));
    expect(container.querySelector('output')?.textContent).toBe('Restoring.');
    await flush();
    expect(restoreDocumentAction).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Bank Statement is back in your current documents.');
    act(() => buttonNamed('Undo')?.click());
    await flush();
    expect(archiveDocumentAction).toHaveBeenCalledWith('a1', 'd1');
    expect(container.textContent).toContain('Undone. It is back in Archived.');
  });
});
