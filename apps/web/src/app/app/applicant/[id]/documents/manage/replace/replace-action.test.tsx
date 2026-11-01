// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  options: vi.fn(),
  replace: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./actions', () => ({
  replaceOptionsAction: mocks.options,
  replaceDocumentAction: mocks.replace,
}));
vi.mock('../../../actions', () => ({ uploadDocumentAction: mocks.upload }));

import { ManageMenu } from '../manage-menu';
import { MANAGE_ACTIONS } from '../registry';
import { confirmMessage, replacedMessage } from './messages';
import { ReplaceAction } from './replace-action';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OLD = '11111111-1111-4111-8111-111111111111';
const NEWER = '22222222-2222-4222-8222-222222222222';
const PENDING = '33333333-3333-4333-8333-333333333333';

const loaded = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  docType: 'PASSPORT',
  kindLabel: 'Passport',
  candidates: [
    {
      documentId: PENDING,
      name: 'Passport, Newest',
      uploadedAt: '2026-11-01T00:00:00Z',
      status: 'CHECKING',
    },
    {
      documentId: NEWER,
      name: 'Passport, Renewed',
      uploadedAt: '2026-10-30T00:00:00Z',
      status: 'READY',
    },
  ],
  cases: [
    { missionId: 'm1', title: 'Japan Visit' },
    { missionId: 'm2', title: 'UK Visit' },
  ],
  pdfAccepted: false,
  ...overrides,
});

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  vi.useRealTimers();
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

async function render() {
  await act(async () => {
    root.render(
      <ReplaceAction
        applicantId="a1"
        documentId={OLD}
        documentName="Passport, Old"
        onClose={onClose}
      />,
    );
  });
}
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const radio = (id: string) =>
  container.querySelector<HTMLInputElement>(`input[type="radio"][value="${id}"]`);
async function click(element: Element | null | undefined) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

describe('Replace with a Newer Document', () => {
  it('is registered under its own words in the Manage menu', () => {
    expect(MANAGE_ACTIONS.REPLACE?.label).toBe('Replace with a Newer Document');
    expect(MANAGE_ACTIONS.REPLACE?.Component).toBe(ReplaceAction);
  });

  it('offers only checked documents, then names the cases before replacing', async () => {
    mocks.options.mockResolvedValue(loaded());
    mocks.replace.mockResolvedValue({ ok: true, message: replacedMessage(2) });
    await render();
    expect(mocks.options).toHaveBeenCalledWith('a1', OLD);
    expect(radio(PENDING)?.disabled).toBe(true);
    expect(container.textContent).toContain('Still being checked');
    // Nothing chosen: Continue stays focusable but does nothing.
    expect(button('Continue')?.getAttribute('aria-disabled')).toBe('true');
    await click(button('Continue'));
    expect(container.querySelector('h3')?.textContent).toBe('Replace with a Newer Document');

    await act(async () => {
      radio(NEWER)?.click();
    });
    expect(button('Continue')?.getAttribute('aria-disabled')).toBeNull();
    await click(button('Continue'));

    const heading = container.querySelector('h3');
    expect(heading?.textContent).toBe('Replace Passport, Old?');
    expect(document.activeElement).toBe(heading);
    expect(container.textContent).toContain(
      '2 cases will be updated and will need to be confirmed again.',
    );
    expect(
      [...container.querySelectorAll('.lc-replace-cases li')].map((li) => li.textContent),
    ).toEqual(['Japan Visit', 'UK Visit']);

    await click(button('Replace'));
    expect(mocks.replace).toHaveBeenCalledWith('a1', OLD, NEWER);
    expect(container.querySelector('output')?.textContent).toBe(replacedMessage(2));
    expect(document.activeElement).toBe(container.querySelector('h3'));
    // The page is redrawn only when the person is done reading the result line.
    expect(mocks.refresh).not.toHaveBeenCalled();
    await click(button('Done'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('shows a refusal in plain words and lets the person go back', async () => {
    mocks.options.mockResolvedValue(loaded());
    mocks.replace.mockResolvedValue({
      ok: false,
      message: 'The newer document is still being checked. Try again in a moment.',
    });
    await render();
    await act(async () => {
      radio(NEWER)?.click();
    });
    await click(button('Continue'));
    await click(button('Replace'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('still being checked');
    await click(button('Back'));
    expect(container.querySelector('h3')?.textContent).toBe('Replace with a Newer Document');
  });

  it('adds a new document of the same kind, then reads the list again until it is checked', async () => {
    vi.useFakeTimers();
    mocks.options
      .mockResolvedValueOnce(loaded({ candidates: [], cases: [] }))
      .mockResolvedValueOnce(
        loaded({
          candidates: [
            {
              documentId: PENDING,
              name: 'Passport, New',
              uploadedAt: '2026-11-01T00:00:00Z',
              status: 'CHECKING',
            },
          ],
          cases: [],
        }),
      )
      .mockResolvedValue(
        loaded({
          candidates: [
            {
              documentId: PENDING,
              name: 'Passport, New',
              uploadedAt: '2026-11-01T00:00:00Z',
              status: 'READY',
            },
          ],
          cases: [],
        }),
      );
    mocks.upload.mockResolvedValue({ ok: true, message: 'Added' });
    await render();
    expect(container.textContent).toContain('You have no other document of this kind yet.');
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    const file = new File(['x'], 'passport.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
    });
    const sent = mocks.upload.mock.calls[0]?.[1] as FormData;
    expect(sent.get('applicantId')).toBe('a1');
    expect(sent.get('docType')).toBe('PASSPORT');
    expect(sent.get('file')).toBe(file);
    expect(container.textContent).toContain('We are checking it now');
    expect(radio(PENDING)?.disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(radio(PENDING)?.disabled).toBe(false);
    const calls = mocks.options.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    // Checked: the list stops being read again.
    expect(mocks.options.mock.calls.length).toBe(calls);
  });

  it('keeps watching a check that was already running, then offers Check Again', async () => {
    vi.useFakeTimers();
    mocks.options.mockResolvedValue(
      loaded({
        candidates: [
          {
            documentId: PENDING,
            name: 'Passport, New',
            uploadedAt: '2026-11-01T00:00:00Z',
            status: 'CHECKING',
          },
          {
            documentId: NEWER,
            name: 'Passport, Failed',
            uploadedAt: '2026-10-30T00:00:00Z',
            status: 'CANNOT_USE',
          },
        ],
      }),
    );
    await render();
    expect(container.textContent).toContain('Cannot be used');
    expect(radio(NEWER)?.disabled).toBe(true);
    const first = mocks.options.mock.calls.length;
    for (let i = 0; i < 10; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(mocks.options.mock.calls.length).toBe(first + 10);
    expect(button('Check Again')).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(mocks.options.mock.calls.length).toBe(first + 10);
    await click(button('Check Again'));
    expect(button('Check Again')).toBeUndefined();
  });

  it('says why when the document cannot be replaced, with a way out', async () => {
    mocks.options.mockResolvedValue({
      ok: false,
      message: 'You can replace only your own documents.',
    });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'You can replace only your own documents.',
    );
    await click(button('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('the Replace It link from a reminder', () => {
  it('opens Replace on the linked document at once', async () => {
    mocks.options.mockResolvedValue(loaded());
    await act(async () => {
      root.render(
        <ManageMenu
          applicantId="a1"
          documentId={OLD}
          documentName="Passport, Old"
          actions={['ARCHIVE', 'REPLACE']}
          initialAction="REPLACE"
        />,
      );
    });
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Replace with a Newer Document',
    );
    expect(mocks.options).toHaveBeenCalledWith('a1', OLD);
    // Nothing had focus yet: the flow takes it, so the person lands in it.
    expect(document.activeElement).toBe(container.querySelector('h3'));
  });
});

describe('the words', () => {
  it('counts cases exactly', () => {
    expect(confirmMessage(0)).toBe('No open case uses this document, so nothing else changes.');
    expect(confirmMessage(1)).toBe('1 case will be updated and will need to be confirmed again.');
    expect(confirmMessage(2)).toBe('2 cases will be updated and will need to be confirmed again.');
    expect(replacedMessage(2)).toContain('2 cases were updated and need to be confirmed again.');
    expect(replacedMessage(1)).toBe(
      'Replaced. 1 case was updated and needs to be confirmed again. The old document stays in your records, marked Replaced.',
    );
  });
});
