// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  preview: vi.fn(),
  remove: vi.fn(),
  info: vi.fn(),
  restore: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./actions', () => ({
  deletePreviewAction: mocks.preview,
  deleteDuplicateAction: mocks.remove,
  restoreInfoAction: mocks.info,
  restoreDeletedAction: mocks.restore,
}));

import { MANAGE_ACTIONS } from '../registry';
import { DeleteDuplicateAction } from './delete-action';
import { casesLine, daysLeft, deletedLine, removedInLine } from './messages';
import { RestoreDeletedAction } from './restore-action';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC = '11111111-1111-4111-8111-111111111111';

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  onClose.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name);
async function click(element: Element | null | undefined) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}
async function show(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

describe('Delete Duplicate words', () => {
  it('counts days and cases plainly', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(daysLeft('2026-12-01T00:00:00Z', now)).toBe(30);
    expect(daysLeft('2026-10-01T00:00:00Z', now)).toBe(0);
    expect(removedInLine(1)).toBe('Removed in 1 Day');
    expect(removedInLine(12)).toBe('Removed in 12 Days');
    expect(casesLine(0)).toBe('No open case uses this copy, so nothing else changes.');
    expect(casesLine(2)).toBe(
      '2 open cases use this copy. They will switch to the copy that stays and will need to be confirmed again.',
    );
    expect(deletedLine(30)).toBe('Moved to Recently Deleted. Removed in 30 Days.');
  });

  it('is registered under its own words', () => {
    expect(MANAGE_ACTIONS.DELETE_DUPLICATE?.label).toBe('Delete Duplicate');
    expect(MANAGE_ACTIONS.DELETE_DUPLICATE?.Component).toBe(DeleteDuplicateAction);
    expect(MANAGE_ACTIONS.RESTORE_DELETED?.label).toBe('Restore');
    expect(MANAGE_ACTIONS.RESTORE_DELETED?.Component).toBe(RestoreDeletedAction);
  });
});

describe('Delete Duplicate', () => {
  it('names the copy that stays and the cases, then offers Undo', async () => {
    mocks.preview.mockResolvedValue({
      ok: true,
      survivorName: 'Passport, Kept',
      cases: [{ missionId: 'm1', title: 'Japan Visit' }],
      purgeAfter: '2026-12-01T00:00:00Z',
    });
    mocks.remove.mockResolvedValue({ ok: true, days: 30 });
    mocks.restore.mockResolvedValue({ ok: true });
    await show(
      <DeleteDuplicateAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport, Copy"
        onClose={onClose}
      />,
    );
    expect(mocks.preview).toHaveBeenCalledWith('a1', DOC);
    expect(container.textContent).toContain('Passport, Kept');
    expect(container.textContent).toContain('Japan Visit');
    expect(container.textContent).toContain(casesLine(1));
    await click(button('Delete Duplicate'));
    expect(mocks.remove).toHaveBeenCalledWith('a1', DOC);
    expect(container.querySelector('h3')?.textContent).toBe('Duplicate Deleted');
    expect(container.querySelector('output')?.textContent).toContain(deletedLine(30));
    expect(mocks.refresh).not.toHaveBeenCalled();
    await click(button('Undo'));
    expect(mocks.restore).toHaveBeenCalledWith('a1', DOC, 'UNDO');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('says why, with Archive offered, when deleting is refused', async () => {
    mocks.preview.mockResolvedValue({
      ok: true,
      survivorName: 'Passport, Kept',
      cases: [],
      purgeAfter: '2026-12-01T00:00:00Z',
    });
    mocks.remove.mockResolvedValue({
      ok: false,
      message:
        'A finished case used this copy, so it is kept with that case. You can archive it instead.',
    });
    await show(
      <DeleteDuplicateAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport, Copy"
        onClose={onClose}
      />,
    );
    await click(button('Delete Duplicate'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('archive it instead');
    await click(button('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Restore from Recently Deleted', () => {
  it('says how long is left, then restores', async () => {
    mocks.info.mockResolvedValue({ ok: true, days: 12 });
    mocks.restore.mockResolvedValue({ ok: true });
    await show(
      <RestoreDeletedAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport, Copy"
        onClose={onClose}
      />,
    );
    expect(container.textContent).toContain('Removed in 12 Days');
    await click(button('Restore'));
    expect(mocks.restore).toHaveBeenCalledWith('a1', DOC, 'RECENTLY_DELETED');
    expect(container.querySelector('h3')?.textContent).toBe('Document Restored');
    await click(button('Done'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('shows the refusal when its time is over', async () => {
    mocks.info.mockResolvedValue({
      ok: false,
      message: 'Its 30 days are over and it is being removed, so it cannot be restored.',
    });
    await show(
      <RestoreDeletedAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport, Copy"
        onClose={onClose}
      />,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('cannot be restored');
    expect(button('Restore')).toBeUndefined();
  });
});
