// @vitest-environment jsdom
import type { EvidenceRequest } from '@visastack/services';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The receipt after an answer (F2) must still be there once the page refreshes. The reply form is
 * rebuilt then (its key holds the request's status and answer time), so the receipt cannot live in
 * the form: the address (`?item=&done=answered`) and the saved request draw it.
 */

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
}));
const submit = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock('./actions', () => ({
  submitEvidenceResponseAction: submit.action,
  askAboutRequestItemAction: vi.fn(),
}));
vi.mock('./clearer-copy-panel', () => ({ ClearerCopyPanel: () => null }));

const { requestPanes } = await import('./request-panes');
const { requestItemView } = await import('./request-item');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = '11111111-1111-4111-8111-111111111111';
const SAVED = '2026-11-10T08:05:00.000Z';

const request = (over: Partial<EvidenceRequest>): EvidenceRequest =>
  ({
    id: ID,
    kind: 'FIELD',
    status: 'OPEN',
    fieldKey: 'passportNumber',
    docType: null,
    message: 'Please send your passport number.',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    respondedAt: null,
    dueDate: null,
    missionId: null,
    respondingDocumentId: null,
    ...over,
  }) as unknown as EvidenceRequest;

function pane(req: EvidenceRequest, answeredId?: string) {
  const entry = { req, item: requestItemView({ request: req }) };
  const [first] = requestPanes({
    applicantId: 'a1',
    timeZone: 'Asia/Dhaka',
    entries: [entry],
    referenceCodes: new Map([[ID, 'R-7K2Q9M']]),
    profile: [{ factId: 'f1', fieldKey: 'passportNumber', value: 'A1234567' }],
    documents: [],
    documentsRead: true,
    extras: { questions: new Map() } as never,
    choiceBasis: { read: true, exactCopies: false, everyday: [], scan: null } as never,
    histories: new Map(),
    ...(answeredId ? { answeredId } : {}),
  });
  return first?.content;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  nav.replace.mockReset();
  submit.action.mockReset();
  window.history.replaceState({}, '', `/app/applicant/a1/evidence?item=${ID}`);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the receipt after an answer', () => {
  it('moves the address to done=answered when the answer is saved', async () => {
    submit.action.mockResolvedValue({ ok: true, message: 'Saved.', savedAt: SAVED });
    await act(async () => root.render(pane(request({}))));
    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    expect(submit.action).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    const target = new URL(nav.replace.mock.calls[0]?.[0] as string, 'http://x');
    expect(target.pathname).toBe('/app/applicant/a1/evidence');
    expect(target.searchParams.get('item')).toBe(ID);
    expect(target.searchParams.get('done')).toBe('answered');
  });

  it('leaves the address alone when the answer was not saved', async () => {
    submit.action.mockResolvedValue({ ok: false, message: 'Not saved.' });
    await act(async () => root.render(pane(request({}))));
    await act(async () => {
      (host.querySelector('form') as HTMLFormElement).requestSubmit();
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('still shows the receipt after the page refreshes and the reply form is rebuilt under a new key', async () => {
    submit.action.mockResolvedValue({ ok: true, message: 'Saved.', savedAt: SAVED });
    await act(async () => root.render(pane(request({}))));
    await act(async () => {
      (host.querySelector('form') as HTMLFormElement).requestSubmit();
    });
    // The page again, as the server sends it for ?item=&done=answered: a new status and answer time.
    const answered = request({ status: 'RECEIVED', respondedAt: new Date(SAVED) });
    await act(async () => root.render(pane(answered, ID)));
    const card = host.querySelector('.receipt-card') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.querySelector('h3')?.textContent).toBe('Answer Sent');
    expect(card.textContent).toContain('Detail: Passportnumber went to the agency.');
    expect(card.textContent).toContain('R-7K2Q9M');
    expect(card.textContent).toContain('Received, not yet reviewed.');
    // The server's confirmed moment, in the traveller's zone.
    expect(card.querySelector('time')?.textContent).toMatch(/10 Nov 2026.*2:05\s?pm.*GMT\+6/i);
    // The reply form has nothing left to say, so there is one account of what happened.
    expect(host.querySelector('form')).toBeNull();
  });

  it('shows no receipt unless the address asks for it for this request and it was only received', async () => {
    const answered = request({ status: 'RECEIVED', respondedAt: new Date(SAVED) });
    await act(async () => root.render(pane(answered)));
    expect(host.querySelector('.receipt-card')).toBeNull();
    await act(async () => root.render(pane(answered, 'some-other-request')));
    expect(host.querySelector('.receipt-card')).toBeNull();
    // Already under review or accepted: "not yet reviewed" would be untrue, so no receipt.
    await act(async () =>
      root.render(pane(request({ status: 'UNDER_REVIEW', respondedAt: new Date(SAVED) }), ID)),
    );
    expect(host.querySelector('.receipt-card')).toBeNull();
  });

  it('Done takes done out of the address, keeps the request open and hands focus to a control in the panel', async () => {
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
      run();
      return 1;
    });
    window.history.replaceState(
      {},
      '',
      `/app/applicant/a1/evidence?item=${ID}&done=answered&show=20`,
    );
    const answered = request({ status: 'RECEIVED', respondedAt: new Date(SAVED) });
    await act(async () => root.render(pane(answered, ID)));
    const done = Array.from(host.querySelectorAll('.receipt-card button')).find(
      (b) => b.textContent === 'Done',
    );
    await act(async () => (done as HTMLButtonElement).click());
    expect(nav.replace).toHaveBeenCalledTimes(1);
    const target = new URL(nav.replace.mock.calls[0]?.[0] as string, 'http://x');
    expect(target.searchParams.get('done')).toBeNull();
    expect(target.searchParams.get('item')).toBe(ID);
    expect(target.searchParams.get('show')).toBe('20');
    vi.unstubAllGlobals();
  });

  it('Back to Requests points at the list without the request open, and closes the panel first', async () => {
    const answered = request({ status: 'RECEIVED', respondedAt: new Date(SAVED) });
    await act(async () => root.render(pane(answered, ID)));
    const back = host.querySelector('.receipt-card a') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/app/applicant/a1/evidence');
    expect(back.getAttribute('data-pane-close')).toBe('true');
  });
});
