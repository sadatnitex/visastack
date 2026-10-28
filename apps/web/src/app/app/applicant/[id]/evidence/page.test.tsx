import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listEvidenceRequestsForApplicant: vi.fn(),
  referenceCodesFor: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listEvidenceRequestDecisions: vi.fn(),
  requireAccess: vi.fn(),
  listRequestItemExtras: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  listEvidenceRequestsForApplicant: mocks.listEvidenceRequestsForApplicant,
  referenceCodesFor: mocks.referenceCodesFor,
  listApplicantProfile: async () => [],
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  listEvidenceRequestDecisions: mocks.listEvidenceRequestDecisions,
  requireAccess: mocks.requireAccess,
  listRequestItemExtras: mocks.listRequestItemExtras,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('./submit-response-form', () => ({ SubmitResponseForm: stub('SubmitResponseForm') }));
vi.mock('./ask-about-item-form', () => ({ AskAboutItemForm: stub('AskAboutItemForm') }));

const { default: EvidencePage } = await import('./page');
const render = () => renderServer(EvidencePage({ params: Promise.resolve({ id: 'a1' }) }));

const request = {
  id: 'r1',
  kind: 'DOCUMENT',
  docType: 'BANK_STATEMENT',
  fieldKey: null,
  status: 'OPEN',
  message: null,
  dueDate: null,
  missionId: null,
  respondingDocumentId: null,
  respondedAt: null,
};

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  originalName: 'statement.pdf',
  approvedName: null,
  docType: 'BANK_STATEMENT',
  latestVersionId: 'v1',
  safetyStatus: 'CLEAN',
  processingStatus: 'AWAITING_REVIEW',
  ...over,
});

const NO_EXTRAS = { ok: true, value: { rules: new Map(), questions: new Map() } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'owner',
    displayName: 'R',
    timezone: 'Asia/Dhaka',
  });
  mocks.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [request] });
  mocks.referenceCodesFor.mockResolvedValue(new Map());
  mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  mocks.listEvidenceRequestDecisions.mockResolvedValue({ ok: true, value: [] });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { gate: 'proof' } });
  mocks.listRequestItemExtras.mockResolvedValue(NO_EXTRAS);
});

const withRequests = (...requests: Record<string, unknown>[]) =>
  mocks.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: requests });

describe('request reference codes on the evidence page (ADR 0018)', () => {
  it('shows each request code, read in one call for the listed requests', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    const html = await render();
    expect(mocks.referenceCodesFor).toHaveBeenCalledWith(expect.anything(), 'R', ['r1']);
    expect(textOf(html)).toContain('Request Reference');
    expect(html).toContain('R-7K2Q9M');
  });

  it('shows no code before migration 0091 has run', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map());
    expect(textOf(await render())).not.toContain('Request Reference');
  });
});

describe('each item shows its group and what to do (spec B09, WP-V4 U07)', () => {
  it('says Missing for a request still open, with the next step and the response form', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Missing');
    expect(text).toContain('Next: send a document from your wallet');
    expect(html).toContain('request-item-warning');
    const [form] = stubProps<{ awaiting: boolean; timeZone: string }>(html, 'SubmitResponseForm');
    expect(form).toMatchObject({ awaiting: true, timeZone: 'Asia/Dhaka' });
  });

  it('calls a request the agency has Received, never Submitted, and does not claim a review', async () => {
    withRequests({ ...request, status: 'RECEIVED', respondingDocumentId: 'd1' });
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc()] });
    const text = textOf(await render());
    expect(text).toContain('Received');
    expect(text).toContain('Received does not mean accepted');
    expect(text).not.toMatch(/Submitted|Reviewed/);
  });

  it('says Processing while a sent file is still being checked', async () => {
    withRequests({ ...request, status: 'RECEIVED', respondingDocumentId: 'd1' });
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ processingStatus: 'SCANNING', safetyStatus: 'SCANNING' })],
    });
    const text = textOf(await render());
    expect(text).toContain('Processing');
    expect(text).toContain('still being checked');
    expect(text).not.toContain('Received does not mean accepted');
  });

  it('says Needs Correction when the file that was sent can no longer be used, and offers a question', async () => {
    withRequests({
      ...request,
      status: 'RECEIVED',
      respondingDocumentId: 'd1',
      missionId: 'm1',
    });
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc({ safetyStatus: 'QUARANTINED', processingStatus: 'NEEDS_ATTENTION' })],
    });
    const html = await render();
    expect(textOf(html)).toContain('Needs Correction');
    expect(textOf(html)).toContain('could not be used');
    expect(stubProps(html, 'AskAboutItemForm')).toHaveLength(1);
  });

  it('says Needs Correction for a request sent back, shows the reason, and says Reviewed only once accepted', async () => {
    withRequests(
      { ...request, id: 'r1', status: 'NEEDS_REPLACEMENT' },
      { ...request, id: 'r2', status: 'ACCEPTED', respondedAt: new Date('2026-10-27T08:32:00Z') },
    );
    mocks.listEvidenceRequestDecisions.mockImplementation(
      async (_db: unknown, _a: string, id: string) =>
        id === 'r1'
          ? {
              ok: true,
              value: [{ outcome: 'NEEDS_REPLACEMENT', reason: 'The last page is cut off.' }],
            }
          : { ok: true, value: [] },
    );
    const text = textOf(await render());
    expect(text).toContain('Needs Correction');
    expect(text).toContain('Replacement needed: The last page is cut off.');
    expect(text).toContain('Reviewed');
    expect(text).toContain('You sent this on 27 Oct 2026, 14:32 GMT+6.');
  });

  it('shows no old reason beside a request that was answered again, and reads reasons only where one applies', async () => {
    withRequests(
      { ...request, id: 'r1', status: 'RECEIVED' },
      { ...request, id: 'r2', status: 'ACCEPTED' },
      { ...request, id: 'r3', status: 'NEEDS_REPLACEMENT' },
    );
    mocks.listEvidenceRequestDecisions.mockResolvedValue({
      ok: true,
      value: [{ outcome: 'NEEDS_REPLACEMENT', reason: 'The last page is cut off.' }],
    });
    const text = textOf(await render());
    expect(mocks.listEvidenceRequestDecisions).toHaveBeenCalledTimes(1);
    expect(mocks.listEvidenceRequestDecisions).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'r3',
    );
    expect(text.match(/The last page is cut off\./g)).toHaveLength(1);
  });

  it('shows a cancelled or older closed request as closed, with no form and no question box', async () => {
    withRequests(
      { ...request, id: 'r1', status: 'CANCELLED', missionId: 'm1' },
      { ...request, id: 'r2', status: 'FULFILLED', missionId: 'm1' },
    );
    mocks.referenceCodesFor.mockResolvedValue(
      new Map([
        ['r1', 'R-AAAAAA'],
        ['r2', 'R-BBBBBB'],
      ]),
    );
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Cancelled');
    expect(text).toContain('Closed');
    expect(text).not.toMatch(/Reviewed|Fulfilled/);
    expect(stubProps(html, 'SubmitResponseForm')).toHaveLength(0);
    expect(stubProps(html, 'AskAboutItemForm')).toHaveLength(0);
  });

  it('keeps requests waiting on the person first, soonest deadline first, and counts them', async () => {
    withRequests(
      { ...request, id: 'late', docType: 'PASSPORT', status: 'RECEIVED' },
      { ...request, id: 'soon', docType: 'VISA', status: 'OPEN', dueDate: new Date('2026-12-01') },
      {
        ...request,
        id: 'sooner',
        docType: 'BANK_STATEMENT',
        status: 'OPEN',
        dueDate: new Date('2026-11-01'),
      },
    );
    const text = textOf(await render());
    expect(text).toContain('2 requests are waiting for you.');
    expect(text.indexOf('Bank Statement')).toBeLessThan(text.indexOf('Visa'));
    expect(text.indexOf('Visa')).toBeLessThan(text.indexOf('Passport'));
  });
});

describe('what the checklist says and the questions already asked', () => {
  it('shows the checklist date range, optional note, and keeps raw codes out', async () => {
    mocks.listRequestItemExtras.mockResolvedValue({
      ok: true,
      value: {
        rules: new Map([['r1', { maxAgeDays: 90, optional: true }]]),
        questions: new Map(),
      },
    });
    const text = textOf(await render());
    expect(text).toContain('The checklist asks for something dated within the last 90 days.');
    expect(text).toContain('This item is optional on the checklist.');
    expect(text).not.toContain('BANK_STATEMENT');
  });

  it('reads the extras through the owner gate with the codes already shown', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    await render();
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'VIEW_METADATA',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
    expect(mocks.listRequestItemExtras).toHaveBeenCalledWith(
      { gate: 'proof' },
      new Map([['r1', 'R-7K2Q9M']]),
    );
  });

  it('still shows every request when the gate or the extras fail', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(textOf(await render())).toContain('Missing');
    mocks.requireAccess.mockResolvedValue({ ok: true, value: {} });
    mocks.listRequestItemExtras.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(textOf(await render())).toContain('Missing');
  });

  it('lists the questions asked, links to the case notes, and offers the box only with a case and a code', async () => {
    withRequests({ ...request, missionId: 'm1' }, { ...request, id: 'r2', missionId: null });
    mocks.referenceCodesFor.mockResolvedValue(
      new Map([
        ['r1', 'R-7K2Q9M'],
        ['r2', 'R-ZZZZZZ'],
      ]),
    );
    mocks.listRequestItemExtras.mockResolvedValue({
      ok: true,
      value: {
        rules: new Map(),
        questions: new Map([
          [
            'r1',
            [{ text: 'Is a photo of the page enough?', askedAt: new Date('2026-10-27T08:32:00Z') }],
          ],
        ]),
      },
    });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Your Questions');
    expect(text).toContain('Asked 27 Oct 2026, 14:32 GMT+6');
    expect(text).toContain('Is a photo of the page enough?');
    expect(html).toContain('href="/app/mission/m1#notes"');
    const asks = stubProps<{ missionId: string; requestId: string; maxLength: number }>(
      html,
      'AskAboutItemForm',
    );
    expect(asks).toEqual([
      expect.objectContaining({ missionId: 'm1', requestId: 'r1', maxLength: 500 }),
    ]);
  });

  it('stops offering the box once the limit is reached and points to the case notes', async () => {
    withRequests({ ...request, missionId: 'm1' });
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    const asked = Array.from({ length: 5 }, (_, i) => ({
      text: `Question ${i}`,
      askedAt: new Date(Date.UTC(2026, 9, 27, 8, i)),
    }));
    mocks.listRequestItemExtras.mockResolvedValue({
      ok: true,
      value: { rules: new Map(), questions: new Map([['r1', asked]]) },
    });
    const html = await render();
    expect(stubProps(html, 'AskAboutItemForm')).toHaveLength(0);
    expect(textOf(html)).toContain('You have asked several questions about this item');
  });
});
