// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  options: vi.fn(),
  replace: vi.fn(),
  upload: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./actions', () => ({
  replaceOptionsAction: mocks.options,
  replaceDocumentAction: mocks.replace,
  previewReplaceImpactAction: mocks.preview,
}));
vi.mock('../../../actions', () => ({ uploadDocumentAction: mocks.upload }));

import {
  APPLICANT_ID,
  DOCUMENT_PREVIEW,
  DOCUMENT_RECORDED,
  DOCUMENT_SUBJECT,
  LIVE_CASE,
  QUIET_EMPTY,
  item,
  review,
} from '../../../change-impact/fixtures.test-support';
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
  // Unless a test says otherwise the review cannot be read: the flow then works as it always did.
  mocks.preview.mockResolvedValue(null);
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

describe('What This Change Affects in the replace flow', () => {
  async function toConfirm() {
    mocks.options.mockResolvedValue(loaded());
    await render();
    await act(async () => {
      radio(NEWER)?.click();
    });
    await click(button('Continue'));
  }

  it('shows the preview for the chosen document in place of the list of cases', async () => {
    mocks.preview.mockResolvedValue(DOCUMENT_PREVIEW);
    await toConfirm();
    expect(mocks.preview).toHaveBeenCalledWith('a1', OLD, NEWER);
    expect(container.querySelector('h3')?.textContent).toBe('Replace Passport, Old?');
    expect(container.querySelector('h4')?.textContent).toBe('What This Change Affects');
    expect(container.textContent).toContain(
      `${LIVE_CASE} uses this document. After you replace it, the case will ask you to choose the document it should use and to confirm it again.`,
    );
    // The review takes the place of the plain list and its count sentence: no second copy.
    expect(container.querySelector('.lc-replace-cases')).toBeNull();
    expect(container.textContent).not.toContain('will be updated and will need to be confirmed');
    expect(container.textContent).not.toContain('We could not work out');
    expect(container.textContent).toContain('The old document stays in your records');
    expect(button('Replace')?.getAttribute('aria-disabled')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the list of cases and says so when the preview cannot be read; Replace still works', async () => {
    mocks.preview.mockRejectedValue(new Error('network'));
    mocks.replace.mockResolvedValue({ ok: true, message: replacedMessage(2), impact: null });
    await toConfirm();
    expect(
      [...container.querySelectorAll('.lc-replace-cases li')].map((li) => li.textContent),
    ).toEqual(['Japan Visit', 'UK Visit']);
    expect(container.textContent).toContain(
      '2 cases will be updated and will need to be confirmed again.',
    );
    expect(container.textContent).toContain(
      'We could not work out what else this change affects this time. You can still replace the document.',
    );
    await click(button('Replace'));
    expect(mocks.replace).toHaveBeenCalledWith('a1', OLD, NEWER);
    expect(container.querySelector('output')?.textContent).toBe(replacedMessage(2));
    expect(container.textContent).toContain(
      'We could not work out what else this change affects this time. The replacement itself is done.',
    );
    expect(container.querySelector('a')).toBeNull();
  });

  const caseNames = () =>
    [...container.querySelectorAll('.lc-replace-cases li')].map((li) => li.textContent);
  const COUNT_LINE = '2 cases will be updated and will need to be confirmed again.';

  it('keeps the plain list of cases and their count when the review could not check the cases', async () => {
    mocks.preview.mockResolvedValue(
      review(DOCUMENT_SUBJECT, 'PREVIEW', [
        item('COULD_NOT_CHECK', { kind: 'AREA', area: 'CASES' }),
      ]),
    );
    await toConfirm();
    expect(caseNames()).toEqual(['Japan Visit', 'UK Visit']);
    expect(container.textContent).toContain(COUNT_LINE);
    // The review is drawn as well, with its own note that it may be missing something.
    expect(container.querySelector('.ci-review')).not.toBeNull();
    expect(container.querySelector('.ci-incomplete')).not.toBeNull();
  });

  it('keeps the plain list of cases and their count while the review is still being worked out', async () => {
    mocks.preview.mockReturnValue(new Promise(() => undefined));
    await toConfirm();
    expect(caseNames()).toEqual(['Japan Visit', 'UK Visit']);
    expect(container.textContent).toContain(COUNT_LINE);
    expect(container.querySelector('output')?.textContent).toBe(
      'Working out what this change affects.',
    );
    expect(container.querySelector('.ci-review')).toBeNull();
  });

  it.each([
    ['returned nothing', () => Promise.resolve(null)],
    ['threw', () => Promise.reject(new Error('network'))],
  ])('keeps the plain list of cases and their count when the review %s', async (_name, failed) => {
    mocks.preview.mockImplementation(failed);
    await toConfirm();
    expect(caseNames()).toEqual(['Japan Visit', 'UK Visit']);
    expect(container.textContent).toContain(COUNT_LINE);
    expect(container.querySelector('.ci-review')).toBeNull();
  });

  it('announces that the review is ready in the one polite line that said it was being worked out', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.preview.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await toConfirm();
    const line = container.querySelector('output');
    expect(line?.textContent).toBe('Working out what this change affects.');
    await act(async () => {
      finish(DOCUMENT_PREVIEW);
    });
    // The same element, so a screen reader hears the change; only one output is in the step.
    expect(container.querySelectorAll('output')).toHaveLength(1);
    expect(container.querySelector('output')).toBe(line);
    expect(line?.textContent).toBe('The list of what this change affects is ready below.');
    expect(container.querySelector('.ci-review')).not.toBeNull();
    expect(container.querySelector('.lc-replace-cases')).toBeNull();
  });

  it('never makes the person wait for the preview before replacing', async () => {
    mocks.preview.mockReturnValue(new Promise(() => undefined));
    mocks.replace.mockResolvedValue({ ok: true, message: replacedMessage(0), impact: QUIET_EMPTY });
    await toConfirm();
    expect(container.querySelector('output')?.textContent).toBe(
      'Working out what this change affects.',
    );
    expect(button('Replace')?.getAttribute('aria-disabled')).toBeNull();
    await click(button('Replace'));
    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(container.querySelector('h3')?.textContent).toBe('Document Replaced');
  });

  it('shows the recorded review after replacing, with a link to open it again', async () => {
    mocks.preview.mockResolvedValue(DOCUMENT_PREVIEW);
    mocks.replace.mockResolvedValue({
      ok: true,
      message: replacedMessage(1),
      impact: DOCUMENT_RECORDED,
    });
    await toConfirm();
    await click(button('Replace'));
    expect(container.querySelector('output')?.textContent).toBe(replacedMessage(1));
    expect(container.textContent).toContain(`${LIVE_CASE} still uses the earlier document.`);
    expect(container.textContent).not.toContain('uses this document. After you replace it');
    const again = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Open This as a Page',
    );
    expect(again?.getAttribute('href')).toBe(`/app/applicant/a1/change-impact?document=${OLD}`);
    // Links in the review lead to the screens that own each step; the review has no button.
    expect(container.querySelectorAll('.ci-review button')).toHaveLength(0);
    expect(
      [...container.querySelectorAll('.ci-review a')].some(
        (a) => a.getAttribute('href') === `/app/applicant/${APPLICANT_ID}/sharing`,
      ),
    ).toBe(false);
    expect(button('Done')).toBeTruthy();
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

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
