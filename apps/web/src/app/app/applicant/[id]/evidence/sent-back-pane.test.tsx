// @vitest-environment jsdom
import type { DocumentSummary, EvidenceRequest } from '@visastack/services';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestHistory } from './request-thread-data';
import type { SentBackRead } from './sent-back-copy';

/**
 * The page for a document request the agency sent back (13 Nov 2026). The copy that was sent back
 * is read from the decision history, because sending a request back clears the request's own
 * answer pointer. These tests render the real panel with the real choice rules.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('./actions', () => ({
  submitEvidenceResponseAction: vi.fn(),
  askAboutRequestItemAction: vi.fn(),
}));
vi.mock('./clearer-copy-panel', () => ({
  ClearerCopyPanel: (props: { documentId: string; primary?: boolean }) => (
    <div
      data-testid="clearer"
      data-document={props.documentId}
      data-primary={String(props.primary)}
    />
  ),
}));

const { requestPanes } = await import('./request-panes');
const { requestItemView } = await import('./request-item');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = '11111111-1111-4111-8111-111111111111';
const future = new Date(Date.now() + 400 * 86400_000).toISOString();
const past = new Date(Date.now() - 30 * 86400_000).toISOString();

const request = (over: Partial<EvidenceRequest> = {}): EvidenceRequest =>
  ({
    id: ID,
    kind: 'DOCUMENT',
    status: 'NEEDS_REPLACEMENT',
    fieldKey: null,
    docType: 'BANK_STATEMENT',
    message: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    respondedAt: null,
    dueDate: null,
    missionId: null,
    // A send-back clears this pointer: the page must not rely on it.
    respondingDocumentId: null,
    respondingFactId: null,
    organizationId: 'org-1',
    ...over,
  }) as unknown as EvidenceRequest;

const doc = (id: string, over: Partial<DocumentSummary> = {}): DocumentSummary =>
  ({
    id,
    originalName: `${id}.pdf`,
    approvedName: null,
    docType: 'BANK_STATEMENT',
    latestVersionId: `v-${id}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
    createdAt: '2026-10-01T00:00:00Z',
    expiresAt: future,
    ...over,
  }) as DocumentSummary;

const history = (sentBack: SentBackRead): RequestHistory => ({
  decisions: { state: 'none' },
  sends: { state: 'none' },
  sentBack,
});

const exact = (over: Record<string, unknown> = {}): SentBackRead => ({
  state: 'copy',
  copy: {
    precision: 'exact',
    documentId: 'old',
    versionId: 'v-old',
    versionNumber: 1,
    title: 'old-statement.pdf',
    sentAt: new Date('2026-11-01T10:00:00Z'),
    reason: 'Page 2 is cut off.',
    ...over,
  } as never,
});

function pane(args: {
  req?: EvidenceRequest;
  documents: DocumentSummary[];
  sentBack?: SentBackRead | null;
  read?: boolean;
}) {
  const req = args.req ?? request();
  const entry = { req, item: requestItemView({ request: req }) };
  const [first] = requestPanes({
    applicantId: 'a1',
    timeZone: 'Asia/Dhaka',
    entries: [entry],
    referenceCodes: new Map(),
    profile: [],
    documents: args.documents,
    documentsRead: true,
    extras: { questions: new Map() } as never,
    choiceBasis: {
      read: args.read ?? true,
      exactCopies: true,
      everyday: new Set(args.documents.map((d) => d.id.toLowerCase())),
      scan: new Map(),
    },
    histories:
      args.sentBack === null ? new Map() : new Map([[ID, history(args.sentBack ?? exact())]]),
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

const checked = () =>
  [...host.querySelectorAll<HTMLInputElement>('input[type=radio]')].filter((r) => r.checked);
const hidden = (name: string) =>
  host.querySelector<HTMLInputElement>(`input[type=hidden][name=${name}]`)?.value;

describe('a request the agency sent back', () => {
  it('names the exact copy that was sent back and why, from the decision history', async () => {
    await act(async () =>
      root.render(
        pane({ documents: [doc('old'), doc('new', { createdAt: '2026-11-05T00:00:00Z' })] }),
      ),
    );
    const note = host.querySelector('[data-testid=sent-back-note]')?.textContent ?? '';
    expect(note).toContain('old-statement.pdf');
    expect(note).toContain('version 1');
    expect(note).toContain('Reason: Page 2 is cut off.');
  });

  it('marks the sent-back copy, offers a clearer copy for it, and does not choose it', async () => {
    await act(async () => root.render(pane({ documents: [doc('old')] })));
    expect(host.textContent).toContain('Sent Back by the Agency');
    const clearer = host.querySelector('[data-testid=clearer]');
    expect(clearer?.getAttribute('data-document')).toBe('old');
    // It is the only way forward, so it reads as the main action.
    expect(clearer?.getAttribute('data-primary')).toBe('true');
    expect(checked()).toHaveLength(0);
    expect(hidden('documentId')).toBe('');
  });

  it('chooses a corrected copy that replaced the sent-back one, and keeps the clearer copy action secondary', async () => {
    // The corrected copy is a new document; the old one is no longer an everyday copy.
    const corrected = doc('new', { createdAt: '2026-11-05T00:00:00Z' });
    await act(async () => root.render(pane({ documents: [corrected] })));
    expect(checked().map((r) => r.closest('label')?.textContent)).toHaveLength(1);
    expect(hidden('documentId')).toBe('new');
    expect(hidden('documentVersionId')).toBe('v-new');
    expect(host.querySelector('[data-testid=clearer]')).toBeNull();
    expect(host.querySelector('.evidence-add-link')).toBeNull();
  });

  it('treats a newer version of the same document as the corrected copy, not as the one sent back', async () => {
    await act(async () =>
      root.render(
        pane({
          documents: [doc('old', { latestVersionId: 'v-old-2' })],
          sentBack: exact({ versionId: 'v-old-1' }),
        }),
      ),
    );
    expect(hidden('documentId')).toBe('old');
    expect(hidden('documentVersionId')).toBe('v-old-2');
    expect(host.textContent).not.toContain('Sent Back by the Agency');
  });

  it('does not choose an expired copy and says what to do, offering to add a current one', async () => {
    await act(async () =>
      root.render(
        pane({
          documents: [doc('old', { expiresAt: past })],
          sentBack: exact({ documentId: 'gone' }),
        }),
      ),
    );
    expect(checked()).toHaveLength(0);
    expect(host.textContent).toContain('Expired on');
    expect(host.querySelector('.evidence-add-link')?.getAttribute('href')).toBe(
      '/app/applicant/a1/documents/add',
    );
  });

  it('still lets the person choose an expired copy on purpose', async () => {
    await act(async () =>
      root.render(
        pane({
          documents: [doc('x', { expiresAt: past })],
          sentBack: exact({ documentId: 'gone' }),
        }),
      ),
    );
    const radio = host.querySelector<HTMLInputElement>('input[type=radio]');
    expect(radio?.disabled).toBe(false);
  });

  it('chooses nothing and says so when the page cannot tell which copy was sent back', async () => {
    await act(async () =>
      root.render(pane({ documents: [doc('only')], sentBack: { state: 'unknown' } })),
    );
    expect(checked()).toHaveLength(0);
    expect(host.querySelector('[data-testid=sent-back-note]')?.textContent).toContain(
      'cannot tell which copy',
    );
  });

  it('treats a missing history like an unknown one, never as nothing sent back', async () => {
    await act(async () => root.render(pane({ documents: [doc('only')], sentBack: null })));
    expect(checked()).toHaveLength(0);
    expect(host.querySelector('[data-testid=sent-back-note]')).not.toBeNull();
  });

  it('names the document, without a version, for a send recorded before exact copies were kept', async () => {
    await act(async () =>
      root.render(
        pane({
          documents: [doc('old', { approvedName: 'My March Statement' })],
          sentBack: {
            state: 'copy',
            copy: {
              precision: 'document',
              documentId: 'old',
              versionId: null,
              versionNumber: null,
              title: null,
              sentAt: null,
              reason: null,
            },
          },
        }),
      ),
    );
    const note = host.querySelector('[data-testid=sent-back-note]')?.textContent ?? '';
    expect(note).toContain('My March Statement');
    expect(note).toContain('cannot say which version');
  });

  it('offers adding a document when nothing is saved, and sends nothing in advance', async () => {
    await act(async () => root.render(pane({ documents: [], sentBack: exact() })));
    expect(host.querySelector('.evidence-add-link')).not.toBeNull();
    expect(checked()).toHaveLength(0);
  });

  it('does not show a sent-back note for a request that is simply open', async () => {
    await act(async () =>
      root.render(
        pane({
          req: request({ status: 'OPEN' }),
          documents: [doc('a')],
          sentBack: { state: 'none' },
        }),
      ),
    );
    expect(host.querySelector('[data-testid=sent-back-note]')).toBeNull();
    // An in-date only-copy is still chosen in advance, as before.
    expect(hidden('documentId')).toBe('a');
  });

  it('leaves an archived or replaced copy out of the list but still names it as the one sent back', async () => {
    await act(async () =>
      root.render(
        pane({ documents: [doc('new')], sentBack: exact({ documentId: 'archived-doc' }) }),
      ),
    );
    expect(host.querySelector('[data-testid=sent-back-note]')?.textContent).toContain(
      'old-statement.pdf',
    );
    expect(hidden('documentId')).toBe('new');
  });
});
