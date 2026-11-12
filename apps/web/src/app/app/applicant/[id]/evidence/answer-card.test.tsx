import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';
import { countProse } from '../../../../../lib/prose-budget.test-support';

/**
 * The card above the list of requests, and the "Asked by" line in a request's panel. Both are new
 * and additive: nothing else on the Requests page moves, and the page never fails because the card
 * could not be drawn.
 */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listEvidenceRequestsForApplicant: vi.fn(),
  referenceCodesFor: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listRequestHistoriesForOwner: vi.fn(),
  requireAccess: vi.fn(),
  listRequestItemExtras: vi.fn(),
  getDocumentLifecycles: vi.fn(),
  loadVersionScanEvidence: vi.fn(),
  evidenceSubmissionsPresent: vi.fn(),
  listWaitingAgencies: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  listEvidenceRequestsForApplicant: mocks.listEvidenceRequestsForApplicant,
  referenceCodesFor: mocks.referenceCodesFor,
  listApplicantProfile: async () => [],
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  listRequestHistoriesForOwner: mocks.listRequestHistoriesForOwner,
  requireAccess: mocks.requireAccess,
  listRequestItemExtras: mocks.listRequestItemExtras,
  getDocumentLifecycles: mocks.getDocumentLifecycles,
  loadVersionScanEvidence: mocks.loadVersionScanEvidence,
  evidenceSubmissionsPresent: mocks.evidenceSubmissionsPresent,
  listWaitingAgencies: mocks.listWaitingAgencies,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./submit-response-form', () => ({ SubmitResponseForm: stub('SubmitResponseForm') }));
vi.mock('./ask-about-item-form', () => ({ AskAboutItemForm: stub('AskAboutItemForm') }));
vi.mock('./clearer-copy-panel', () => ({ ClearerCopyPanel: stub('ClearerCopyPanel') }));

const { default: EvidencePage } = await import('./page');
const render = () => renderServer(EvidencePage({ params: Promise.resolve({ id: 'a1' }) }));

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const request = (id: string, organizationId: string, over: Record<string, unknown> = {}) => ({
  id,
  organizationId,
  kind: 'DOCUMENT',
  docType: 'BANK_STATEMENT',
  fieldKey: null,
  status: 'OPEN',
  message: null,
  dueDate: null,
  missionId: null,
  respondingDocumentId: null,
  respondedAt: null,
  ...over,
});
const waiting = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG_A,
  organizationName: 'TEST Agency Unrelated',
  waiting: 6,
  documents: 5,
  ...over,
});

function requests(...list: Record<string, unknown>[]) {
  mocks.listEvidenceRequestsForApplicant.mockResolvedValue({
    ok: true,
    value: {
      items: list,
      more: false,
      counts: {
        total: list.length,
        awaiting: list.filter((r) =>
          ['OPEN', 'NEEDS_REPLACEMENT'].includes((r as { status: string }).status),
        ).length,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'owner',
    displayName: 'TEST Rahim Synthetic',
    timezone: 'Asia/Dhaka',
  });
  requests(request('r1', ORG_A));
  mocks.referenceCodesFor.mockResolvedValue(new Map());
  mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { gate: 'proof' } });
  mocks.listRequestItemExtras.mockResolvedValue({
    ok: true,
    value: { rules: new Map(), questions: new Map() },
  });
  mocks.getDocumentLifecycles.mockResolvedValue(new Map());
  mocks.loadVersionScanEvidence.mockResolvedValue(new Map());
  mocks.evidenceSubmissionsPresent.mockResolvedValue(true);
  mocks.listRequestHistoriesForOwner.mockImplementation(
    async (_proof: unknown, input: { requestIds: string[] }) => ({
      ok: true,
      value: new Map(
        input.requestIds.map((id) => [
          id,
          {
            decisions: [],
            sends: { available: false, submissions: [], legacy: [] },
            olderSends: 0,
          },
        ]),
      ),
    }),
  );
  mocks.listWaitingAgencies.mockResolvedValue({ ok: true, value: [waiting()] });
});

describe('the Answer from Your Records card on the Requests page', () => {
  it('names the one agency that waits and links straight to its review', async () => {
    const html = await render();
    expect(textOf(html)).toContain('TEST Agency Unrelated is waiting for 6 answers');
    expect(html).toContain(`href="/app/applicant/a1/evidence/answer?agency=${ORG_A}"`);
    expect(textOf(html)).toContain('Answer from Your Records');
  });

  it('asks the central gate for the owner proof, and reads who waits with it', async () => {
    await render();
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'MANAGE',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
    expect(mocks.listWaitingAgencies).toHaveBeenCalledWith({ gate: 'proof' });
  });

  it('names up to three agencies and links to the list of who is asking', async () => {
    mocks.listWaitingAgencies.mockResolvedValue({
      ok: true,
      value: [
        waiting(),
        waiting({ organizationId: ORG_B, organizationName: 'TEST Agency North', waiting: 1 }),
        waiting({ organizationId: 'c', organizationName: 'TEST Agency Three', waiting: 2 }),
        waiting({ organizationId: 'd', organizationName: 'TEST Agency Four', waiting: 3 }),
      ],
    });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Waiting for Answers');
    expect(text).toContain('TEST Agency Unrelated: 6 answers');
    expect(text).toContain('TEST Agency North: 1 answer');
    expect(text).toContain('TEST Agency Three: 2 answers');
    expect(text).not.toContain('TEST Agency Four');
    expect(html).toContain('href="/app/applicant/a1/evidence/answer"');
    expect(html).not.toContain('evidence/answer?agency=');
  });

  it('shows no card when no agency waits for a document, only for a detail', async () => {
    mocks.listWaitingAgencies.mockResolvedValue({ ok: true, value: [waiting({ documents: 0 })] });
    const html = await render();
    expect(html).not.toContain('evidence/answer');
    expect(textOf(html)).not.toContain('is waiting for 6 answers');
  });

  it('shows no card, and the page still loads, when the proof cannot be had or the read fails', async () => {
    mocks.listWaitingAgencies.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    expect(await render()).not.toContain('evidence/answer');
    mocks.listWaitingAgencies.mockRejectedValue(new Error('down'));
    const html = await render();
    expect(html).not.toContain('evidence/answer');
    expect(textOf(html)).toContain('Requests from Agencies');
  });

  it('stays visible at every depth (it is not tied to a level)', async () => {
    const html = await render();
    const card = html.slice(html.indexOf('answer-card'), html.indexOf('answer-card') + 400);
    expect(card).not.toContain('data-level');
  });

  it('adds no running prose to the page, and nothing else on it moves', async () => {
    mocks.listWaitingAgencies.mockResolvedValue({ ok: true, value: [] });
    const without = await render();
    mocks.listWaitingAgencies.mockResolvedValue({ ok: true, value: [waiting()] });
    const withCard = await render();
    const before = countProse(`<main>${without}</main>`, { viewport: 'phone' }).words;
    const after = countProse(`<main>${withCard}</main>`, { viewport: 'phone' }).words;
    expect(after).toBe(before);
    expect(countProse(`<main>${withCard}</main>`, { viewport: 'phone' }).problems).toEqual([]);
    // Take the card out and the markup is what it was, apart from the one line in each panel.
    const strip = (html: string) =>
      html
        .replace(/<article class="card answer-card">.*?<\/article>/s, '')
        .replace(/<p class="case-row-meta">Asked by [^<]*<\/p>/g, '')
        // A fresh retry key is made for every render.
        .replace(/idempotencyKey&quot;:&quot;[^&]*&quot;/g, '');
    expect(strip(withCard)).toBe(strip(without));
  });
});

describe('the "Asked by" line in a request panel', () => {
  it('names the agency that asked, under the title', async () => {
    requests(request('r1', ORG_A), request('r2', ORG_B, { docType: 'PASSPORT' }));
    mocks.listWaitingAgencies.mockResolvedValue({
      ok: true,
      value: [waiting(), waiting({ organizationId: ORG_B, organizationName: 'TEST Agency North' })],
    });
    const text = textOf(await render());
    expect(text).toContain('Asked by TEST Agency Unrelated');
    expect(text).toContain('Asked by TEST Agency North');
  });

  it('shows no such line when the agency is not known, or the request no longer waits', async () => {
    requests(request('r1', ORG_B), request('r2', ORG_A, { status: 'ACCEPTED' }));
    const text = textOf(await render());
    expect(text).not.toContain('Asked by TEST Agency North');
    mocks.listWaitingAgencies.mockResolvedValue({ ok: true, value: [] });
    expect(textOf(await render())).not.toContain('Asked by');
  });
});
