import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

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
  listEvidenceRequestsForApplicant: async () => state.requests,
  listApplicantProfile: async () => [
    { factId: 'f1', fieldKey: 'passport_number', value: 'A1234567' },
  ],
  listDocumentsDetailed: async () => ({ ok: true, value: state.documents }),
  listEvidenceRequestDecisions: async () => ({ ok: true, value: state.decisions }),
  referenceCodesFor: async () => state.codes,
  requireAccess: async () => ({ ok: true, value: { proof: 'owner' } }),
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

const { default: EvidencePage } = await import('../../app/app/applicant/[id]/evidence/page');

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
        state.decisions = [{ outcome: 'NEEDS_REPLACEMENT', reason: 'The last page is cut off.' }];
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
  const levelOf = (el: Element | null) => el?.getAttribute('data-level') ?? 'glance';
  beforeEach(() => {
    state.decisions = [];
    state.codes = new Map([['r1', 'R-7K2Q9M']]);
    state.questions = new Map([
      ['r1', [{ text: 'Is a photo enough?', askedAt: new Date('2026-10-27T08:32:00Z') }]],
    ]);
  });

  it('keeps a waiting request and its reply at Glance, details at Browse, asking at Everything', async () => {
    state.requests = {
      ok: true,
      value: [
        { ...base, id: 'r1', status: 'OPEN', missionId: 'm1', dueDate: new Date('2026-11-10') },
        { ...base, id: 'r2', status: 'ACCEPTED' },
      ],
    };
    const doc = await page();
    const waiting = doc.getElementById('request-r1');
    expect(levelOf(waiting)).toBe('glance');
    expect(levelOf(doc.getElementById('request-r2'))).toBe('browse');
    expect(waiting?.querySelector('[data-stub="SubmitResponseForm"]')).not.toBeNull();
    expect(levelOf(waiting?.querySelector('[data-stub="SubmitResponseForm"]') ?? null)).toBe(
      'glance',
    );
    expect(levelOf(waiting?.querySelector('.request-questions') ?? null)).toBe('browse');
    expect(levelOf(waiting?.querySelector('details.request-ask') ?? null)).toBe('everything');
    const neededBy = [...(waiting?.querySelectorAll('p') ?? [])].find((p) =>
      p.textContent?.startsWith('Needed by'),
    );
    expect(levelOf(neededBy ?? null)).toBe('browse');
  });

  it('keeps the reason a request was sent back at Glance, beside its reply', async () => {
    state.requests = { ok: true, value: [{ ...base, id: 'r5', status: 'NEEDS_REPLACEMENT' }] };
    state.decisions = [{ outcome: 'NEEDS_REPLACEMENT', reason: 'The last page is cut off.' }];
    const doc = await page();
    const reason = doc.querySelector('#request-r5 .field-msg-err');
    expect(reason?.textContent).toContain('The last page is cut off.');
    expect(levelOf(reason)).toBe('glance');
    expect(levelOf(doc.getElementById('request-r5'))).toBe('glance');
  });

  it('says nothing is waiting at Glance and starts the list at Browse', async () => {
    state.requests = { ok: true, value: [{ ...base, id: 'r6', status: 'ACCEPTED' }] };
    const doc = await page();
    expect(doc.querySelector('[data-only="glance"]')?.textContent).toContain('Nothing is waiting');
    expect(levelOf(doc.querySelector('article.card'))).toBe('browse');
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
