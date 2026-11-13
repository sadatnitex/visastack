// @vitest-environment jsdom
import type { EvidenceRequest, FieldAnswerHistory, FieldAnswerRound } from '@visastack/services';
import { LEGACY_FIELD_ANSWER_LABEL } from '@visastack/services';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestHistory } from './request-thread-data';

/**
 * What a traveller sent in answer to a detail request, shown on the request's own page: the exact
 * saved value and version of each round, never the detail as it is now, and a plain admission for
 * an answer sent before the exact value was kept (13 Nov 2026).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('./actions', () => ({
  submitEvidenceResponseAction: vi.fn(),
  askAboutRequestItemAction: vi.fn(),
}));
vi.mock('./clearer-copy-panel', () => ({ ClearerCopyPanel: () => null }));

// The conversation is an async server component and this test mounts in the browser: it is not
// what this test is about, so it is left out here (its own tests render it on the server).
vi.mock('../../../../../components/request-thread/request-thread', () => ({
  RequestThread: () => null,
}));

const { requestPanes } = await import('./request-panes');
const { requestItemView } = await import('./request-item');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = '11111111-1111-4111-8111-111111111111';

const request = (over: Partial<EvidenceRequest> = {}): EvidenceRequest =>
  ({
    id: ID,
    kind: 'FIELD',
    status: 'ACCEPTED',
    fieldKey: 'phone',
    docType: null,
    message: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    respondedAt: new Date('2026-11-02T00:00:00Z'),
    dueDate: null,
    missionId: null,
    respondingDocumentId: null,
    respondingFactId: 'f1',
    organizationId: 'org-1',
    ...over,
  }) as unknown as EvidenceRequest;

const baseVersion = {
  id: 'v1',
  number: 1,
  savedAt: new Date('2026-11-01T10:00:00Z'),
  protected: false,
  value: '+8801700000111' as string | null,
  stillCurrent: false,
};

const round = (over: Partial<FieldAnswerRound> = {}): FieldAnswerRound => ({
  submissionId: 's1',
  roundNo: 1,
  precision: 'pinned',
  sentAt: new Date('2026-11-02T00:00:00Z'),
  state: 'ACCEPTED',
  decidedAt: new Date('2026-11-03T00:00:00Z'),
  reason: null,
  version: baseVersion,
  ...over,
});

const history = (fieldAnswer: RequestHistory['fieldAnswer']): RequestHistory => ({
  decisions: { state: 'none' },
  sends: { state: 'none' },
  sentBack: { state: 'none' },
  fieldAnswer,
});

const read = (rounds: FieldAnswerRound[]): RequestHistory['fieldAnswer'] => ({
  state: 'read',
  value: { available: true, rounds, legacyLabel: LEGACY_FIELD_ANSWER_LABEL } as FieldAnswerHistory,
});

function pane(h: RequestHistory | null, req = request()) {
  const entry = { req, item: requestItemView({ request: req }) };
  const [first] = requestPanes({
    applicantId: 'a1',
    timeZone: 'Asia/Dhaka',
    entries: [entry],
    referenceCodes: new Map(),
    // The detail NOW says something else: it must never appear as what was sent.
    profile: [{ factId: 'f1', fieldKey: 'phone', value: '+8801700000999' }],
    documents: [],
    documentsRead: true,
    extras: { questions: new Map() } as never,
    choiceBasis: { read: true, exactCopies: true, everyday: new Set(), scan: new Map() },
    histories: h ? new Map([[ID, h]]) : new Map(),
  });
  return first?.content;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const sent = () => host.querySelector('[data-testid=field-answer-sent]')?.textContent ?? '';

describe('what you sent, on a detail request', () => {
  it('shows the exact saved value and version, says it changed since, and never shows the detail as it is now', async () => {
    await act(async () => root.render(pane(history(read([round()])))));
    expect(sent()).toContain('What You Sent');
    expect(sent()).toContain('Accepted');
    expect(sent()).toContain('Version 1');
    expect(sent()).toContain('+8801700000111');
    expect(sent()).toContain('This detail has changed since');
    expect(sent()).not.toContain('+8801700000999');
  });

  it('links to what that change affects, once, and only when the detail has changed', async () => {
    const link = () =>
      [...host.querySelectorAll('[data-testid=field-answer-sent] a')].map((a) => [
        a.textContent,
        a.getAttribute('href'),
      ]);
    const older = round({ submissionId: 's0', roundNo: 0, version: { ...baseVersion, id: 'v0' } });
    await act(async () => root.render(pane(history(read([older, round()])))));
    expect(link()).toEqual([
      ['What This Change Affects', '/app/applicant/a1/change-impact?detail=f1'],
    ]);
    const current = round({ version: { ...baseVersion, stillCurrent: true } });
    await act(async () => root.render(pane(history(read([current])))));
    expect(link()).toEqual([]);
    // No detail named on the request: no address to offer, so no link.
    await act(async () =>
      root.render(pane(history(read([round()])), request({ respondingFactId: null }))),
    );
    expect(link()).toEqual([]);
  });

  it('tells this link apart from the others on the page: it names the request it belongs to', async () => {
    await act(async () => root.render(pane(history(read([round()])))));
    const link = host.querySelector<HTMLAnchorElement>('[data-testid=field-answer-sent] a');
    const describedBy = link?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const title = host.querySelector(`#${describedBy}`);
    expect(title?.tagName).toBe('H3');
    expect(title?.textContent).toBe(host.querySelector('.lp-pane-title')?.textContent);
    expect(title?.textContent).not.toBe('');
    const ids = [...host.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not say it changed when the version sent is still the current one', async () => {
    const current = round({
      version: { ...baseVersion, stillCurrent: true },
    });
    await act(async () => root.render(pane(history(read([current])))));
    expect(sent()).not.toContain('changed since');
  });

  it('lists a rejected round and the corrected one, newest first', async () => {
    await act(async () =>
      root.render(
        pane(
          history(
            read([
              round({ state: 'NEEDS_REPLACEMENT' }),
              round({
                submissionId: 's2',
                roundNo: 2,
                version: {
                  id: 'v2',
                  number: 2,
                  savedAt: new Date('2026-11-04T10:00:00Z'),
                  protected: false,
                  value: '+8801700000222',
                  stillCurrent: true,
                },
              }),
            ]),
          ),
        ),
      ),
    );
    const items = [...host.querySelectorAll('[data-testid=field-answer-sent] li')].map(
      (li) => li.textContent ?? '',
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('+8801700000222');
    expect(items[0]).toContain('Accepted');
    expect(items[1]).toContain('+8801700000111');
    expect(items[1]).toContain('Sent back');
  });

  it('says plainly that an answer sent before the exact value was kept cannot show it', async () => {
    const legacy = round({ submissionId: null, roundNo: null, precision: 'legacy', version: null });
    await act(async () => root.render(pane(history(read([legacy])))));
    expect(sent()).toContain('Sent before the exact value was kept');
    expect(sent()).toContain('cannot show which value was sent');
    expect(sent()).not.toContain('+8801700000999');
  });

  it('names a protected detail by version only', async () => {
    const protectedRound = round({
      version: { ...baseVersion, protected: true, value: null },
    });
    await act(async () => root.render(pane(history(read([protectedRound])))));
    expect(sent()).toContain('a protected detail, not shown here');
    expect(sent()).not.toContain('+8801700000111');
  });

  it('says so when the value could not be loaded, and shows nothing for a request nobody answered', async () => {
    await act(async () => root.render(pane(history({ state: 'unread' }))));
    expect(sent()).toContain('could not be loaded');
    await act(async () => root.render(pane(history({ state: 'none' }))));
    expect(host.querySelector('[data-testid=field-answer-sent]')).toBeNull();
    await act(async () => root.render(pane(null)));
    expect(host.querySelector('[data-testid=field-answer-sent]')).toBeNull();
  });
});
