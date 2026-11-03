// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../../../lib/axe.test-support';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  preview: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./actions', () => ({
  selfDeletePreviewAction: mocks.preview,
  selfDeleteAction: mocks.remove,
}));
vi.mock('../delete/actions', () => ({
  deletePreviewAction: vi.fn(),
  deleteDuplicateAction: vi.fn(),
  restoreInfoAction: vi.fn(),
  restoreDeletedAction: vi.fn(),
}));
vi.mock('../request/actions', () => ({
  requestRemovalAction: vi.fn(),
  cancelRemovalRequestAction: vi.fn(),
}));
vi.mock('../replace/actions', () => ({
  replaceOptionsAction: vi.fn(),
  replaceDocumentAction: vi.fn(),
}));
vi.mock('../archive/actions', () => ({
  archiveDocumentAction: vi.fn(),
  restoreDocumentAction: vi.fn(),
}));
vi.mock('../../../actions', () => ({ uploadDocumentAction: vi.fn() }));

import { ManageMenu } from '../manage-menu';
import { MANAGE_ACTIONS } from '../registry';
import { BACKUP_NOTE, WHAT_HAPPENS, deletedLine, impactLines } from './messages';
import { SelfDeleteAction } from './self-delete-action';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC = '11111111-1111-4111-8111-111111111111';
const NONE = {
  openCases: 0,
  agencies: 0,
  shares: 0,
  profileDetails: 0,
  aiChoices: 0,
  trips: 0,
  contributorHandovers: 0,
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

async function open(onClose = vi.fn()) {
  await act(async () => {
    root.render(
      <SelfDeleteAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport"
        onClose={onClose}
      />,
    );
  });
  return onClose;
}

function type(value: string) {
  const input = container.querySelector('input') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Delete My File in the Manage menu', () => {
  it('is registered under the frozen name, last', () => {
    expect(MANAGE_ACTIONS.DELETE_MY_FILE?.label).toBe('Delete My File');
  });

  it('is listed only when the page offers it', async () => {
    const menu = (actions: readonly ('ARCHIVE' | 'DELETE_MY_FILE')[]) =>
      act(async () => {
        root.render(
          <ManageMenu
            applicantId="a1"
            documentId={DOC}
            documentName="Passport"
            actions={actions}
          />,
        );
      });
    await menu(['ARCHIVE']);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    });
    expect([...container.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual([
      'Archive',
    ]);
    await act(async () => root.unmount());
    root = createRoot(container);
    await menu(['ARCHIVE', 'DELETE_MY_FILE']);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    });
    expect([...container.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual([
      'Archive',
      'Delete My File',
    ]);
  });
});

describe('the confirmation screen', () => {
  it('says only what is needed: the heading, the loss, the lines that are not zero, the backup note, the word, one danger button', async () => {
    mocks.preview.mockResolvedValue({
      ok: true,
      impact: { ...NONE, agencies: 2, openCases: 1, profileDetails: 3 },
      needsFreshSignIn: true,
    });
    await open();
    expect(container.querySelector('h3')?.textContent).toBe('Delete Passport Now?');
    const text = container.textContent ?? '';
    expect(text).toContain(WHAT_HAPPENS);
    expect(text).toContain(
      '2 agencies can see it. They lose access now and are told, without the file name.',
    );
    expect(text).toContain('Used in 1 open case. It will ask you to choose another document.');
    expect(text).toContain(
      '3 profile details were read from it and stay, without this file as their source.',
    );
    expect(text).toContain(BACKUP_NOTE);
    expect(text).toContain(
      'Removed from VisaStack. Backup copies expire within 90 days and are never brought back.',
    );
    expect(container.querySelector('label')?.textContent).toBe('Type DELETE to Confirm');
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelectorAll('p')).toHaveLength(2);
    const filled = [...container.querySelectorAll('button')].filter((b) =>
      /btn-(primary|danger)/.test(b.className),
    );
    expect(filled.map((b) => b.textContent)).toEqual(['Delete File Now']);
    expect(filled[0]?.className).toContain('btn-danger');
    expect(button('Cancel').className).toContain('btn-secondary');
    expect(container.innerHTML).not.toMatch(/style=|mission/i);
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('shows no impact list for a file that touches nothing', async () => {
    mocks.preview.mockResolvedValue({ ok: true, impact: NONE, needsFreshSignIn: false });
    await open();
    expect(container.querySelector('ul')).toBeNull();
    expect(impactLines(NONE)).toEqual([]);
  });

  it('words singular and plural counts correctly', () => {
    expect(impactLines({ ...NONE, agencies: 1, openCases: 1, profileDetails: 1 })).toEqual([
      '1 agency can see it. It loses access now and is told, without the file name.',
      'Used in 1 open case. It will ask you to choose another document.',
      '1 profile detail was read from it and stays, without this file as its source.',
    ]);
    expect(impactLines({ ...NONE, shares: 2 })).toEqual(['2 shares include it. They end now.']);
  });

  it('asks for the word before anything is sent, then sends exactly what was shown', async () => {
    const impact = { ...NONE, openCases: 1 };
    mocks.preview.mockResolvedValue({ ok: true, impact, needsFreshSignIn: true });
    mocks.remove.mockResolvedValue({ ok: true, message: deletedLine('D-7K2Q9M', 'QUEUED') });
    const onClose = await open();
    await act(async () => {
      button('Delete File Now').click();
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Type DELETE to confirm.');

    type('DELETE');
    await act(async () => {
      button('Delete File Now').click();
    });
    expect(mocks.remove).toHaveBeenCalledWith('a1', DOC, 'DELETE', impact);
    expect(container.querySelector('output')?.textContent).toBe(
      'Removing securely. Record D-7K2Q9M is in Removal Records.',
    );
    expect(document.activeElement?.textContent).toBe('File Deleted');
    expect(container.textContent).not.toContain('Passport');
    await act(async () => {
      button('Done').click();
    });
    expect(onClose).toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('shows a refusal in plain words and keeps the file', async () => {
    mocks.preview.mockResolvedValue({ ok: true, impact: NONE, needsFreshSignIn: false });
    mocks.remove.mockResolvedValue({ ok: false, message: 'We have to keep this file for now.' });
    await open();
    type('DELETE');
    await act(async () => {
      button('Delete File Now').click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'We have to keep this file for now.',
    );
    expect(container.querySelector('h3')?.textContent).toBe('Delete Passport Now?');
  });

  it('reads the file again when what it touches changed, and clears the word', async () => {
    mocks.preview
      .mockResolvedValueOnce({ ok: true, impact: NONE, needsFreshSignIn: false })
      .mockResolvedValueOnce({
        ok: true,
        impact: { ...NONE, agencies: 1 },
        needsFreshSignIn: true,
      });
    mocks.remove.mockResolvedValue({ ok: false, message: 'Something changed.', stale: true });
    await open();
    type('DELETE');
    await act(async () => {
      button('Delete File Now').click();
    });
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('1 agency can see it.');
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('');
  });

  it('shows why a file cannot be deleted and offers only Close', async () => {
    mocks.preview.mockResolvedValue({
      ok: false,
      message: 'A finished case used this file, so it is kept with that case.',
    });
    const onClose = await open();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('finished case');
    expect(container.querySelector('input')).toBeNull();
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Close']);
    await act(async () => {
      button('Close').click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close while the deletion is being made', async () => {
    mocks.preview.mockResolvedValue({ ok: true, impact: NONE, needsFreshSignIn: false });
    let finish: (value: { ok: true; message: string }) => void = () => {};
    mocks.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onClose = await open();
    type('DELETE');
    await act(async () => {
      button('Delete File Now').click();
    });
    expect(button('Deleting').getAttribute('aria-disabled')).toBe('true');
    expect(button('Cancel').getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      button('Cancel').click();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, message: 'Removing securely.' }));
  });
});
