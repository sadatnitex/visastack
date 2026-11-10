import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';
import { levelContaining } from './reveal';

/** Evidence Requests (screen 10): see parity-kit.test-support.ts for how the comparison works. */

const state = vi.hoisted(() => ({
  requests: { ok: true, value: [] } as unknown,
  documents: [] as unknown[],
  decisions: [] as unknown[],
  codes: new Map<string, string>(),
  rules: new Map<string, unknown>(),
  questions: new Map<string, unknown>(),
  depth: 'auto',
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: async () => ({
    id: 'person',
    ownerAccountId: 'acct-1',
    displayName: 'Karim Rahman',
    timezone: 'Asia/Dhaka',
  }),
  // WP-SB3: the page reads one page of requests with counts; the fixture lists stay plain.
  listEvidenceRequestsForApplicant: async () => {
    const requests = state.requests as { ok: true; value: { status: string }[] } | { ok: false };
    if (!requests.ok) return requests;
    return {
      ok: true,
      value: {
        items: requests.value,
        more: false,
        counts: {
          total: requests.value.length,
          awaiting: requests.value.filter(
            (request) => request.status === 'OPEN' || request.status === 'NEEDS_REPLACEMENT',
          ).length,
        },
      },
    };
  },
  listApplicantProfile: async () => [
    { factId: 'f1', fieldKey: 'passport_number', value: 'A1234567' },
  ],
  listDocumentsDetailed: async () => ({ ok: true, value: state.documents }),
  // One batched read: the fixtures' decisions go to every request listed; no exact sends are kept
  // (migration 0132 not run), so the decisions tell the story.
  listRequestHistoriesForOwner: async (_proof: unknown, input: { requestIds: string[] }) => ({
    ok: true,
    value: new Map(
      input.requestIds.map((id) => [
        id,
        {
          decisions: state.decisions,
          sends: { available: false, submissions: [], legacy: [] },
          olderSends: 0,
        },
      ]),
    ),
  }),
  referenceCodesFor: async () => state.codes,
  requireAccess: async () => ({ ok: true, value: { proof: 'owner' } }),
  // Every document is the everyday copy; how it was checked is not under test here.
  getDocumentLifecycles: async (_db: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id.toLowerCase(), { state: 'CURRENT', replaced: false }])),
  loadVersionScanEvidence: async () => new Map(),
  evidenceSubmissionsPresent: async () => true,
  listRequestItemExtras: async () => ({
    ok: true,
    value: { rules: state.rules, questions: state.questions },
  }),
}));
vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./depth.server', () => ({ readDepth: async () => state.depth }));
vi.mock('../../app/app/applicant/[id]/evidence/submit-response-form', () => ({
  SubmitResponseForm: stub('SubmitResponseForm'),
}));
vi.mock('../../app/app/applicant/[id]/evidence/ask-about-item-form', () => ({
  AskAboutItemForm: stub('AskAboutItemForm'),
}));
vi.mock('../../app/app/applicant/[id]/evidence/clearer-copy-panel', () => ({
  ClearerCopyPanel: stub('ClearerCopyPanel'),
}));

const { default: EvidencePage } = await import('../../app/app/applicant/[id]/evidence/page');

const SENT_BACK = {
  outcome: 'NEEDS_REPLACEMENT',
  reason: 'The last page is cut off.',
  createdAt: new Date('2026-10-21T09:00:00Z'),
};

const base = {
  kind: 'DOCUMENT',
  docType: 'BANK_STATEMENT',
  fieldKey: null,
  message: null,
  dueDate: null,
  missionId: null,
  respondingDocumentId: null,
  respondedAt: null,
};

registerParity({
  name: 'evidence',
  reset: () => {
    state.requests = { ok: true, value: [] };
    state.documents = [];
    state.decisions = [];
    state.codes = new Map();
    state.rules = new Map();
    state.questions = new Map();
    state.depth = 'auto';
  },
  render: async () =>
    await renderServer(EvidencePage({ params: Promise.resolve({ id: 'person' }) })),
  states: [
    { name: 'no requests yet', setup: () => undefined },
    {
      name: 'two waiting, one received, one accepted, with a question asked',
      setup: () => {
        state.requests = {
          ok: true,
          value: [
            {
              ...base,
              id: 'r1',
              status: 'OPEN',
              message: 'For the embassy file',
              dueDate: new Date('2026-11-10T00:00:00Z'),
              missionId: 'm1',
            },
            {
              ...base,
              id: 'r2',
              kind: 'FIELD',
              docType: null,
              fieldKey: 'passport_number',
              status: 'OPEN',
            },
            {
              ...base,
              id: 'r3',
              status: 'RECEIVED',
              respondingDocumentId: 'd1',
              respondedAt: new Date('2026-10-20T08:00:00Z'),
            },
            { ...base, id: 'r4', docType: 'PASSPORT', status: 'ACCEPTED' },
          ],
        };
        state.documents = [
          {
            id: 'd1',
            originalName: 'statement.pdf',
            approvedName: null,
            docType: 'BANK_STATEMENT',
            latestVersionId: 'v1',
            safetyStatus: 'CLEAN',
            processingStatus: 'AWAITING_REVIEW',
          },
        ];
        state.codes = new Map([
          ['r1', 'R-7K2Q9M'],
          ['r3', 'R-3H8P2W'],
        ]);
        state.rules = new Map([['r1', { maxAgeDays: 90, optional: false }]]);
        state.questions = new Map([
          ['r1', [{ text: 'Is a photo enough?', askedAt: new Date('2026-10-27T08:32:00Z') }]],
        ]);
      },
    },
    {
      name: 'one sent back with a reason',
      setup: () => {
        state.requests = { ok: true, value: [{ ...base, id: 'r5', status: 'NEEDS_REPLACEMENT' }] };
        state.decisions = [SENT_BACK];
      },
    },
    {
      name: 'one sent back, with the copy to replace still among the documents',
      setup: () => {
        state.requests = {
          ok: true,
          value: [{ ...base, id: 'r7', status: 'NEEDS_REPLACEMENT', respondingDocumentId: 'd7' }],
        };
        state.documents = [
          {
            id: 'd7',
            originalName: 'cut-off.pdf',
            approvedName: null,
            docType: 'BANK_STATEMENT',
            latestVersionId: 'v7',
            safetyStatus: 'CLEAN',
            processingStatus: 'AWAITING_REVIEW',
            createdAt: '2026-10-20T08:00:00Z',
          },
        ];
        state.decisions = [SENT_BACK];
      },
    },
    {
      name: 'nothing waiting',
      setup: () => {
        state.requests = { ok: true, value: [{ ...base, id: 'r6', status: 'ACCEPTED' }] };
      },
    },
    {
      name: 'requests could not be read',
      setup: () => {
        state.requests = { ok: false, error: { code: 'upstream_error' } };
      },
    },
  ],
});

describe('evidence request levels', () => {
  const page = async () =>
    new JSDOM(await renderServer(EvidencePage({ params: Promise.resolve({ id: 'person' }) })))
      .window.document;
  // The level at which an element is really on screen: its own and every block around it.
  const levelOf = (el: Element | null | undefined) =>
    el ? levelContaining(el as HTMLElement, el.ownerDocument.body) : 'none';
  const pane = (doc: Document, id: string) => doc.getElementById(`lp-pane-${id}`);
  beforeEach(() => {
    state.decisions = [];
    state.codes = new Map([['r1', 'R-7K2Q9M']]);
    state.questions = new Map([
      ['r1', [{ text: 'Is a photo enough?', askedAt: new Date('2026-10-27T08:32:00Z') }]],
    ]);
  });

  it('keeps a waiting request at Glance and a finished one at Browse, with the reply and the question box in its panel', async () => {
    state.requests = {
      ok: true,
      value: [
        { ...base, id: 'r1', status: 'OPEN', missionId: 'm1', dueDate: new Date('2026-11-10') },
        { ...base, id: 'r2', status: 'ACCEPTED' },
      ],
    };
    const doc = await page();
    expect(levelOf(doc.getElementById('request-r1'))).toBe('glance');
    expect(levelOf(doc.getElementById('request-r2'))).toBe('browse');
    const waiting = pane(doc, 'r1');
    expect(waiting?.querySelector('[data-stub="SubmitResponseForm"]')).not.toBeNull();
    expect(levelOf(waiting?.querySelector('[data-stub="SubmitResponseForm"]') ?? null)).toBe(
      'glance',
    );
    expect(waiting?.querySelector('.request-questions')).not.toBeNull();
    expect(levelOf(waiting?.querySelector('details.request-ask') ?? null)).toBe('everything');
    const neededBy = [...(waiting?.querySelectorAll('p') ?? [])].find((p) =>
      p.textContent?.startsWith('Needed by'),
    );
    expect(neededBy).toBeDefined();
  });

  it('keeps the reason a request was sent back in its conversation, beside the reply', async () => {
    state.requests = { ok: true, value: [{ ...base, id: 'r5', status: 'NEEDS_REPLACEMENT' }] };
    state.decisions = [SENT_BACK];
    const doc = await page();
    expect(levelOf(doc.getElementById('request-r5'))).toBe('glance');
    const messages = [...(pane(doc, 'r5')?.querySelectorAll('.rt-msg') ?? [])];
    const reason = messages.find((m) => m.textContent?.includes('The last page is cut off.'));
    expect(reason?.getAttribute('data-side')).toBe('agency');
    expect(reason?.textContent).toContain('Replacement needed: ');
    expect(levelOf(reason)).toBe('glance');
    // The traveller's earlier send reads Sent Back for a Fix, not Received and never Reviewed.
    expect(messages.some((m) => m.getAttribute('data-word') === 'Sent Back for a Fix')).toBe(true);
    expect(messages.some((m) => m.getAttribute('data-word') === 'Reviewed')).toBe(false);
  });

  it('shows a sent file that could not be used at Glance, with its guidance and the question box', async () => {
    state.requests = {
      ok: true,
      value: [
        { ...base, id: 'r1', status: 'RECEIVED', respondingDocumentId: 'd9', missionId: 'm1' },
      ],
    };
    state.documents = [
      {
        id: 'd9',
        originalName: 'scan.pdf',
        approvedName: null,
        docType: 'BANK_STATEMENT',
        latestVersionId: 'v1',
        safetyStatus: 'QUARANTINED',
        processingStatus: 'FAILED',
      },
    ];
    state.questions = new Map();
    const doc = await page();
    expect(levelOf(doc.getElementById('request-r1'))).toBe('glance');
    const open = pane(doc, 'r1');
    const guidance = [...(open?.querySelectorAll('p') ?? [])].find((p) =>
      p.textContent?.includes('could not be used'),
    );
    expect(levelOf(guidance)).toBe('glance');
    expect(levelOf(open?.querySelector('details.request-ask'))).toBe('glance');
    expect(doc.querySelector('[data-only="glance"]')).toBeNull();
    state.documents = [];
  });

  it('keeps Upload a Clearer Copy in the panel of a request sent back', async () => {
    state.requests = {
      ok: true,
      value: [{ ...base, id: 'r7', status: 'NEEDS_REPLACEMENT', respondingDocumentId: 'd7' }],
    };
    state.documents = [
      {
        id: 'd7',
        originalName: 'cut-off.pdf',
        approvedName: null,
        docType: 'BANK_STATEMENT',
        latestVersionId: 'v7',
        safetyStatus: 'CLEAN',
        processingStatus: 'AWAITING_REVIEW',
        createdAt: '2026-10-20T08:00:00Z',
      },
    ];
    const doc = await page();
    const panel = pane(doc, 'r7')?.querySelector('[data-stub="ClearerCopyPanel"]');
    expect(panel).not.toBeNull();
    expect(levelOf(panel)).toBe('glance');
  });

  it('says nothing is waiting at Glance and starts the list at Browse', async () => {
    state.requests = { ok: true, value: [{ ...base, id: 'r6', status: 'ACCEPTED' }] };
    const doc = await page();
    expect(doc.querySelector('[data-only="glance"]')?.textContent).toContain('Nothing is waiting');
    expect(levelOf(doc.querySelector('.req-grid'))).toBe('browse');
  });

  it('says the requests could not be loaded at every level, never that there are none', async () => {
    state.requests = { ok: false, error: { code: 'upstream_error' } };
    const doc = await page();
    const alert = doc.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('could not be loaded');
    expect(levelOf(doc.querySelector('article.card'))).toBe('glance');
    expect(doc.body.textContent).not.toContain('No Evidence Requests');
  });
});
